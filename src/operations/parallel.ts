import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { validateInput } from '../core/validate.js';
import { resolveKeyframes } from '../core/keyframes.js';
import { VIDEO_INPUT_FORMATS } from '../core/formats.js';
import { planSegments, type Segment } from '../core/segments.js';
import { InvalidFormatError, InvalidOptionsError } from '../errors/index.js';
import type { ParallelConvertOptions } from '../types/index.js';
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
 * Transcodes a video by splitting it on keyframe boundaries, re-encoding the
 * chunks in parallel (one FFmpeg worker each), then concatenating them without
 * re-encoding. Boundaries land on keyframes, so the joins are artefact-free.
 *
 * Accepts MP4, MOV, WebM and MKV inputs — keyframes come from the ISOBMFF `stss`
 * box when available, otherwise from ffprobe. Output is always MP4.
 *
 * @param input - Path to the source video (MP4/MOV/WebM/MKV).
 * @param output - Path to the destination MP4 file.
 * @param options - Worker count, target bitrate, and progress/abort options.
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

  const workers = resolveWorkers(options.workers, cpus().length);

  const keyframes = await resolveKeyframes(input);
  const segments = planSegments(keyframes, { workerCount: workers });
  const { duration: totalDuration, audio } = await probe(input);

  const workDir = await mkdtemp(join(tmpdir(), 'ffm-parallel-'));
  try {
    // The audio is encoded as a single continuous pass and muxed back at the end.
    // Splitting audio across the chunks would re-prime the AAC encoder at every
    // junction, accumulating gaps/drift and an A/V offset. Keeping it whole makes
    // the joins seamless regardless of how many chunks the video is cut into.
    const audioTrack = audio !== null ? join(workDir, 'audio.m4a') : undefined;
    const videoTarget = audioTrack === undefined ? output : join(workDir, 'video.mp4');

    await Promise.all([
      transcodeSegments(input, segments, workDir, totalDuration, options).then((chunks) =>
        concatChunks(chunks, workDir, videoTarget, options.signal),
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

/** Re-encodes the video of every segment in parallel; returns chunk paths in output order. */
async function transcodeSegments(
  input: string,
  segments: Segment[],
  workDir: string,
  totalDuration: number,
  options: ParallelConvertOptions,
): Promise<string[]> {
  const binary = resolveBinary('ffmpeg');
  const chunks: string[] = [];
  const processedByWorker = new Array<number>(segments.length).fill(0);

  const reportAggregate = (index: number, currentTime: number): void => {
    if (options.onProgress === undefined) return;
    processedByWorker[index] = currentTime;
    const processed = processedByWorker.reduce((a, b) => a + b, 0);
    const percent = totalDuration > 0 ? Math.min(100, (processed / totalDuration) * 100) : 0;
    options.onProgress({ percent, currentTime: processed, totalTime: totalDuration });
  };

  await Promise.all(
    segments.map(async (seg) => {
      const chunk = join(workDir, `chunk_${String(seg.index).padStart(4, '0')}.mp4`);
      chunks[seg.index] = chunk;

      const chunkDuration = seg.endTime !== undefined ? seg.endTime - seg.startTime : totalDuration - seg.startTime;
      // Video-only chunk (-an): audio is handled separately, in one pass.
      const args = ['-ss', String(seg.startTime), '-i', input];
      if (seg.endTime !== undefined) args.push('-t', String(chunkDuration));
      args.push('-an', '-c:v', 'libx264');
      if (options.targetBitrate !== undefined) args.push('-b:v', options.targetBitrate);
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
    }),
  );

  return chunks;
}

/** Joins the chunks with the concat demuxer (no re-encode). */
async function concatChunks(
  chunks: string[],
  workDir: string,
  output: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  const listFile = join(workDir, 'chunks.txt');
  await writeFile(listFile, chunks.map((path) => `file '${path}'`).join('\n'), 'utf8');

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args: ['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-y', output],
    ...(signal !== undefined ? { signal } : {}),
  });
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
