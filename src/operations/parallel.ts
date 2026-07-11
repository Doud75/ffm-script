import { mkdtemp, rm } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { concatDemuxer } from '../core/concat.js';
import { qualityArgs, assertQualityBitrateExclusive } from '../core/quality.js';
import { buildScaleFilter } from '../core/scale.js';
import { resolveOutputContainer } from '../core/container.js';
import { validateInput } from '../core/validate.js';
import { resolveKeyframes } from '../core/keyframes.js';
import { VIDEO_INPUT_FORMATS } from '../core/formats.js';
import {
  planSegments,
  type Segment,
  type SegmentExecutor,
  type SegmentExecutorContext,
} from '../core/segments.js';
import { InvalidFormatError, InvalidOptionsError } from '../errors/index.js';
import type { ParallelConvertOptions, Progress } from '../types/index.js';
import { probe } from './probe.js';

/**
 * Resolves how many parallel FFmpeg workers to run.
 *
 * - Omitted → half the host's logical cores (at least 1). Each FFmpeg process is
 *   itself multithreaded and tries to grab the whole CPU, so spawning one worker
 *   per core oversubscribes the machine and makes it unusable. Half leaves room to
 *   keep working, and on a hyperthreaded host "half the logical cores" ≈ the
 *   physical core count — the right granularity for encoding.
 * - Provided → validated as a positive integer, then capped at the core count:
 *   asking for more workers than cores would only oversubscribe the CPU.
 *
 * @throws {InvalidOptionsError} when a provided `requested` is not a positive integer.
 */
export function resolveWorkers(requested: number | undefined, cpuCount: number): number {
  if (requested === undefined) {
    return Math.max(1, Math.floor(cpuCount / 2));
  }
  if (!Number.isInteger(requested) || requested < 1) {
    throw new InvalidOptionsError(`workers must be a positive integer (got ${requested})`);
  }
  return Math.min(requested, cpuCount);
}

/**
 * Resolves the concurrency for a custom {@link SegmentExecutor}: how many segments
 * are encoded at once (and how finely the timeline is split). Unlike
 * {@link resolveWorkers} it is **not** capped to the local core count — remote
 * workers aren't bound by this machine's CPU. Falls back to `fallback` (the
 * core-based default) when omitted.
 *
 * @throws {InvalidOptionsError} when `requested` is not a positive integer.
 */
export function resolveConcurrency(requested: number | undefined, fallback: number): number {
  if (requested === undefined) return fallback;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new InvalidOptionsError(`concurrency must be a positive integer (got ${requested})`);
  }
  return requested;
}

/**
 * Validates the retry count: how many times a failed segment is re-attempted
 * before giving up. Defaults to `0` (a single attempt).
 *
 * @throws {InvalidOptionsError} when `requested` is not a non-negative integer.
 */
export function resolveRetries(requested: number | undefined): number {
  if (requested === undefined) return 0;
  if (!Number.isInteger(requested) || requested < 0) {
    throw new InvalidOptionsError(`retries must be a non-negative integer (got ${requested})`);
  }
  return requested;
}

/**
 * Validates the delay (ms) between a failed attempt and the next retry. Defaults
 * to `0` (retry immediately).
 *
 * @throws {InvalidOptionsError} when `requested` is not a non-negative number.
 */
export function resolveRetryDelay(requested: number | undefined): number {
  if (requested === undefined) return 0;
  if (!Number.isFinite(requested) || requested < 0) {
    throw new InvalidOptionsError(
      `retryDelay must be a non-negative number of milliseconds (got ${requested})`,
    );
  }
  return requested;
}

/** True when `err` is an abort (a `DOMException` named `'AbortError'`) — never retry these. */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * Runs `attempt`, re-running it up to `retries` times when it rejects. An abort is
 * intentional, never a transient failure, so it rethrows at once without retrying.
 * Between attempts it waits `retryDelay` ms (interrupted by `signal`), and runs
 * `onRetry` first (e.g. to reset that segment's reported progress).
 */
async function withRetry<T>(
  attempt: () => Promise<T>,
  retries: number,
  retryDelay: number,
  signal: AbortSignal | undefined,
  onRetry: () => void,
): Promise<T> {
  // Built once (not at the call site) so the delayed retry is a single, fully
  // exercised path — the aborted wait rejects, ending the retries.
  const delayOptions: { signal?: AbortSignal } = {};
  if (signal !== undefined) delayOptions.signal = signal;

  for (let remaining = retries; ; remaining--) {
    try {
      return await attempt();
    } catch (err) {
      if (remaining <= 0 || signal?.aborted === true || isAbortError(err)) throw err;
      onRetry();
      if (retryDelay > 0) await sleep(retryDelay, undefined, delayOptions);
    }
  }
}

/** Extra segments per worker, so a slow chunk can't leave the pool idle. */
const SEGMENTS_PER_WORKER = 3;
/** Don't carve chunks shorter than this — sub-chunk encoder warm-up isn't worth it. */
const MIN_CHUNK_SECONDS = 5;

/**
 * Decides how many segments to cut the timeline into. More segments than workers
 * lets the bounded pool rebalance — when one chunk runs long, idle workers pick up
 * the remaining shorter chunks instead of waiting. Bounded so chunks stay at least
 * {@link MIN_CHUNK_SECONDS} long, and never more than the available keyframes.
 */
export function planSegmentCount(
  workers: number,
  totalDuration: number,
  keyframeCount: number,
): number {
  const maxByMinChunk = Math.max(workers, Math.floor(totalDuration / MIN_CHUNK_SECONDS));
  return Math.min(workers * SEGMENTS_PER_WORKER, maxByMinChunk, keyframeCount);
}

/**
 * Aggregates per-segment progress into an overall {@link Progress}.
 *
 * Contributions are weighted by duration: each segment reports the *seconds* it
 * has processed (not its own percentage), and those seconds are summed against
 * the total. A long chunk therefore moves the bar more than a short one — unlike
 * naively averaging each segment's percentage, which would over-weight short
 * chunks.
 *
 * @param processedBySegment - Seconds processed so far, per segment.
 * @param totalDuration - Sum of every segment's duration, in seconds.
 */
export function aggregateProgress(processedBySegment: number[], totalDuration: number): Progress {
  const processed = processedBySegment.reduce((a, b) => a + b, 0);
  const percent = totalDuration > 0 ? Math.min(100, (processed / totalDuration) * 100) : 0;
  return { percent, currentTime: processed, totalTime: totalDuration };
}

/**
 * Transcodes a video by splitting it on keyframe boundaries, re-encoding the
 * chunks in parallel (one FFmpeg worker each), then concatenating them without
 * re-encoding. Boundaries land on keyframes, so the joins are artefact-free.
 *
 * Don't expect a speedup on a single machine: FFmpeg (libx264) already saturates
 * every core with its internal threading, so local workers only re-share the same
 * cores. This function is the local, correctness-validated form of the chunked
 * model — the speedup comes from encoding the chunks on independent machines. Pass
 * a custom `executor` to distribute the per-segment encodes: `parallelConvert`
 * still plans the split, encodes the audio in one pass and joins the chunks, but
 * calls the executor to produce each video chunk (see {@link SegmentExecutor}). Use
 * `concurrency` to control how many run at once, uncapped by the local core count,
 * and `retries` to re-attempt a segment whose (e.g. remote) encode fails.
 *
 * Accepts MP4, MOV, WebM and MKV inputs — keyframes come from the ISOBMFF `stss`
 * box when available, otherwise from ffprobe. Output is MP4, MOV or MKV (chosen
 * from the output extension); the chunks are re-encoded to h264 and the audio to
 * aac, then joined with stream copy — codecs WebM cannot carry, so WebM output is
 * rejected (use {@link convert} for WebM).
 *
 * @param input - Path to the source video (MP4/MOV/WebM/MKV).
 * @param output - Path to the destination file; its extension picks the container (`.mp4`/`.mov`/`.mkv`).
 * @param options - Worker/concurrency count, custom executor, retry policy, target bitrate/quality, output resolution, and progress/abort options.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when `input` is not a supported video container, the output extension is unsupported or WebM, or the input has no video keyframes.
 * @throws {InvalidOptionsError} when `workers`/`concurrency` is not a positive integer, or `retries`/`retryDelay` is negative.
 * @throws {FFmpegError} when any FFmpeg process exits non-zero.
 */
export async function parallelConvert(
  input: string,
  output: string,
  options: ParallelConvertOptions = {},
): Promise<void> {
  await validateInput(input, VIDEO_INPUT_FORMATS);
  const { container } = resolveOutputContainer(output);
  if (container === 'webm') {
    throw new InvalidFormatError(
      output,
      'parallelConvert cannot output WebM: its copy-based concat/mux pipeline produces h264/aac; use convert() for WebM',
    );
  }
  assertQualityBitrateExclusive(options.quality, options.videoBitrate);

  const localWorkers = resolveWorkers(options.workers, cpus().length);
  const concurrency =
    options.executor !== undefined
      ? resolveConcurrency(options.concurrency, localWorkers)
      : localWorkers;
  const retries = resolveRetries(options.retries);
  const retryDelay = resolveRetryDelay(options.retryDelay);

  const keyframes = await resolveKeyframes(input);
  const { duration: totalDuration, audio } = await probe(input);
  const segments = planSegments(keyframes, {
    segmentCount: planSegmentCount(concurrency, totalDuration, keyframes.length),
  });

  const workDir = await mkdtemp(join(tmpdir(), 'ffm-parallel-'));
  try {
    const executor = options.executor ?? createLocalExecutor(workDir);
    // The audio is encoded as a single continuous pass and muxed back at the end.
    // Splitting audio across the chunks would re-prime the AAC encoder at every
    // junction, accumulating gaps/drift and an A/V offset. Keeping it whole makes
    // the joins seamless regardless of how many chunks the video is cut into.
    const audioTrack = audio !== null ? join(workDir, 'audio.m4a') : undefined;
    const videoTarget = audioTrack === undefined ? output : join(workDir, 'video.mp4');

    await Promise.all([
      transcodeSegments(input, segments, totalDuration, concurrency, executor, options, {
        retries,
        retryDelay,
      }).then((chunks) =>
        concatDemuxer(
          chunks,
          videoTarget,
          options.signal !== undefined ? { signal: options.signal } : {},
        ),
      ),
      audioTrack !== undefined ? encodeAudio(input, audioTrack, options.signal) : Promise.resolve(),
    ]);

    if (audioTrack !== undefined) {
      await muxAudioVideo(videoTarget, audioTrack, output, options.signal);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Builds the shared per-chunk video-encode flags — the same for every segment so
 * that all chunks come out with one encoding and the concat demuxer can
 * stream-copy the joins. Excludes input, seek and output (the executor wraps those
 * around it). Video-only (`-an`): the audio is handled separately, in one pass.
 *
 * The scale filter (when set) is identical on every chunk, and since all chunks
 * share the source dimensions the `-2` placeholder resolves the same everywhere.
 */
function buildSegmentEncodeArgs(options: ParallelConvertOptions): string[] {
  const args = ['-an', '-c:v', 'libx264'];
  if (options.quality !== undefined) args.push(...qualityArgs(options.quality));
  if (options.videoBitrate !== undefined) args.push('-b:v', options.videoBitrate);
  const scale = buildScaleFilter(options.width, options.height);
  if (scale !== undefined) args.push('-vf', scale);
  return args;
}

/**
 * The default {@link SegmentExecutor}: encodes each chunk with a local FFmpeg
 * process into `workDir`, wrapping the shared encode args with the segment's seek
 * and (for all but the final segment) its duration.
 */
function createLocalExecutor(workDir: string): SegmentExecutor {
  const binary = resolveBinary('ffmpeg');
  return async (segment, ctx) => {
    const chunk = join(workDir, `chunk_${String(segment.index).padStart(4, '0')}.mp4`);
    const args = [
      '-ss',
      String(segment.startTime),
      '-i',
      ctx.input,
      // -t only for a bounded segment; the last one (no endTime) runs to EOF.
      ...(segment.endTime !== undefined ? ['-t', String(ctx.duration)] : []),
      ...ctx.encodeArgs,
      '-y',
      chunk,
    ];
    const report = ctx.onProgress;
    await spawnFFmpeg({
      binary,
      args,
      duration: ctx.duration,
      ...(report !== undefined ? { onProgress: (p) => report(p.currentTime) } : {}),
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
    });
    return chunk;
  };
}

/**
 * Encodes every segment through `executor`, running at most `concurrency` at once.
 * There are usually more segments than that, so the pool rebalances: whenever one
 * finishes it picks up the next. A segment whose encode fails is re-attempted up
 * to `retry.retries` times (never on abort). Progress is aggregated across
 * segments, weighted by duration.
 *
 * Returns chunk paths in output order.
 */
async function transcodeSegments(
  input: string,
  segments: Segment[],
  totalDuration: number,
  concurrency: number,
  executor: SegmentExecutor,
  options: ParallelConvertOptions,
  retry: { retries: number; retryDelay: number },
): Promise<string[]> {
  const chunks: string[] = [];
  const processedBySegment = new Array<number>(segments.length).fill(0);
  const encodeArgs = buildSegmentEncodeArgs(options);

  // Captured (and narrowed) once: the per-segment reporter only exists when the
  // caller wants progress, so there is no dead undefined-check on the hot path.
  const onProgress = options.onProgress;
  const reportAggregate =
    onProgress !== undefined
      ? (index: number, currentTime: number): void => {
          processedBySegment[index] = currentTime;
          onProgress(aggregateProgress(processedBySegment, totalDuration));
        }
      : undefined;

  await runPool(segments, concurrency, async (seg) => {
    const duration =
      seg.endTime !== undefined ? seg.endTime - seg.startTime : totalDuration - seg.startTime;
    const ctx: SegmentExecutorContext = {
      input,
      encodeArgs,
      duration,
      ...(reportAggregate !== undefined
        ? { onProgress: (secondsProcessed: number) => reportAggregate(seg.index, secondsProcessed) }
        : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    };
    chunks[seg.index] = await withRetry(
      () => executor(seg, ctx),
      retry.retries,
      retry.retryDelay,
      options.signal,
      // A failed attempt may have reported partial seconds — reset so the retry
      // doesn't leave a stale count inflating the aggregate.
      () => {
        processedBySegment[seg.index] = 0;
      },
    );
  });

  return chunks;
}

/**
 * Runs `task` over `items` with at most `concurrency` in flight at once. Each lane
 * pulls the next item as soon as it is free, so longer tasks don't stall the rest.
 */
async function runPool<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index]!);
    }
  });
  await Promise.all(lanes);
}

/** Encodes the whole audio track in a single pass (no junctions → no drift). */
async function encodeAudio(
  input: string,
  output: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args: ['-i', input, '-vn', '-c:a', 'aac', '-y', output],
    ...(signal !== undefined ? { signal } : {}),
  });
}

/** Muxes the concatenated video with the single-pass audio (no re-encode). */
async function muxAudioVideo(
  video: string,
  audio: string,
  output: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args: ['-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-y', output],
    ...(signal !== undefined ? { signal } : {}),
  });
}
