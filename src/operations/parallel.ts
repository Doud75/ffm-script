import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { validateInput } from '../core/validate.js';
import { extractKeyframeIndex } from '../core/mp4.js';
import { planSegments, type Segment } from '../core/segments.js';
import { InvalidFormatError, InvalidOptionsError } from '../errors/index.js';
import type { ParallelConvertOptions } from '../types/index.js';
import { probe } from './probe.js';

/**
 * Transcodes an MP4 by splitting it on keyframe boundaries, re-encoding the
 * chunks in parallel (one FFmpeg worker each), then concatenating them without
 * re-encoding. Boundaries land on keyframes, so the joins are artefact-free.
 *
 * @param input - Path to the source MP4 file.
 * @param output - Path to the destination MP4 file.
 * @param options - Worker count, target bitrate, and progress/abort options.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when `input`/`output` is not MP4, or the input has no keyframe index.
 * @throws {InvalidOptionsError} when `workers` is not a positive integer.
 * @throws {FFmpegError} when any FFmpeg process exits non-zero.
 */
export async function parallelConvert(
  input: string,
  output: string,
  options: ParallelConvertOptions = {},
): Promise<void> {
  await validateInput(input, ['.mp4']);
  if (extname(output).toLowerCase() !== '.mp4') {
    throw new InvalidFormatError(output, 'output must be an .mp4 file');
  }

  const workers = options.workers ?? cpus().length;
  if (!Number.isInteger(workers) || workers < 1) {
    throw new InvalidOptionsError(`workers must be a positive integer (got ${workers})`);
  }

  const keyframes = await extractKeyframeIndex(input);
  const segments = planSegments(keyframes, { workerCount: workers });
  const { duration: totalDuration } = await probe(input);

  const workDir = await mkdtemp(join(tmpdir(), 'ffm-parallel-'));
  try {
    const chunks = await transcodeSegments(input, segments, workDir, totalDuration, options);
    await concatChunks(chunks, workDir, output, options.signal);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Re-encodes every segment in parallel; returns chunk paths in output order. */
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
      const args = ['-ss', String(seg.startTime), '-i', input];
      if (seg.endTime !== undefined) args.push('-t', String(chunkDuration));
      args.push('-c:v', 'libx264');
      if (options.targetBitrate !== undefined) args.push('-b:v', options.targetBitrate);
      args.push('-c:a', 'aac', '-y', chunk);

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
