import { mkdtemp, rm } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { concatDemuxer } from '../core/concat.js';
import { qualityArgs, assertQualityBitrateExclusive } from '../core/quality.js';
import { buildScaleFilter } from '../core/scale.js';
import { validateInput } from '../core/validate.js';
import { resolveKeyframes } from '../core/keyframes.js';
import { VIDEO_INPUT_FORMATS } from '../core/formats.js';
import { planSegments, type Segment } from '../core/segments.js';
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
export function planSegmentCount(workers: number, totalDuration: number, keyframeCount: number): number {
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
 * Accepts MP4, MOV, WebM and MKV inputs — keyframes come from the ISOBMFF `stss`
 * box when available, otherwise from ffprobe. Output is always MP4.
 *
 * @param input - Path to the source video (MP4/MOV/WebM/MKV).
 * @param output - Path to the destination MP4 file.
 * @param options - Worker count, target bitrate/quality, output resolution, and progress/abort options.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when `input` is not a supported video container, `output` is not MP4, or the input has no video keyframes.
 * @throws {InvalidOptionsError} when `workers` is not a positive integer.
 * @throws {FFmpegError} when any FFmpeg process exits non-zero.
 */
export async function parallelConvert(
  input: string,
  output: string,
  options: ParallelConvertOptions = {},
): Promise<void> {
  await validateInput(input, VIDEO_INPUT_FORMATS);
  if (extname(output).toLowerCase() !== '.mp4') {
    throw new InvalidFormatError(output, 'output must be an .mp4 file');
  }
  assertQualityBitrateExclusive(options.quality, options.targetBitrate);

  const workers = resolveWorkers(options.workers, cpus().length);

  const keyframes = await resolveKeyframes(input);
  const { duration: totalDuration, audio } = await probe(input);
  const segments = planSegments(keyframes, {
    segmentCount: planSegmentCount(workers, totalDuration, keyframes.length),
  });

  const workDir = await mkdtemp(join(tmpdir(), 'ffm-parallel-'));
  try {
    // The audio is encoded as a single continuous pass and muxed back at the end.
    // Splitting audio across the chunks would re-prime the AAC encoder at every
    // junction, accumulating gaps/drift and an A/V offset. Keeping it whole makes
    // the joins seamless regardless of how many chunks the video is cut into.
    const audioTrack = audio !== null ? join(workDir, 'audio.m4a') : undefined;
    const videoTarget = audioTrack === undefined ? output : join(workDir, 'video.mp4');

    await Promise.all([
      transcodeSegments(input, segments, workDir, totalDuration, workers, options).then((chunks) =>
        concatDemuxer(chunks, videoTarget, options.signal !== undefined ? { signal: options.signal } : {}),
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
 * Re-encodes the video of every segment, running at most `concurrency` workers at
 * once. There are usually more segments than workers, so the pool rebalances:
 * whenever a worker finishes a chunk it picks up the next one.
 *
 * Returns chunk paths in output order.
 */
async function transcodeSegments(
  input: string,
  segments: Segment[],
  workDir: string,
  totalDuration: number,
  concurrency: number,
  options: ParallelConvertOptions,
): Promise<string[]> {
  const binary = resolveBinary('ffmpeg');
  const chunks: string[] = [];
  const processedBySegment = new Array<number>(segments.length).fill(0);

  const reportAggregate = (index: number, currentTime: number): void => {
    if (options.onProgress === undefined) return;
    processedBySegment[index] = currentTime;
    options.onProgress(aggregateProgress(processedBySegment, totalDuration));
  };

  await runPool(segments, concurrency, async (seg) => {
    const chunk = join(workDir, `chunk_${String(seg.index).padStart(4, '0')}.mp4`);
    chunks[seg.index] = chunk;

    const chunkDuration = seg.endTime !== undefined ? seg.endTime - seg.startTime : totalDuration - seg.startTime;
    // Video-only chunk (-an): audio is handled separately, in one pass.
    const args = ['-ss', String(seg.startTime), '-i', input];
    if (seg.endTime !== undefined) args.push('-t', String(chunkDuration));
    args.push('-an', '-c:v', 'libx264');
    if (options.quality !== undefined) args.push(...qualityArgs(options.quality));
    if (options.targetBitrate !== undefined) args.push('-b:v', options.targetBitrate);
    // Same scale filter on every chunk → uniform resolution, so the concat
    // demuxer can still stream-copy the joins. All chunks share the source
    // dimensions, so the `-2` placeholder resolves identically everywhere.
    const scale = buildScaleFilter(options.width, options.height);
    if (scale !== undefined) args.push('-vf', scale);
    args.push('-y', chunk);

    await spawnFFmpeg({
      binary,
      args,
      duration: chunkDuration,
      ...(options.onProgress !== undefined
        ? { onProgress: (p) => reportAggregate(seg.index, p.currentTime) }
        : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
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
