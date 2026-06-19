import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveBinary } from './binary.js';
import { spawnFFmpeg } from './spawn.js';
import type { Progress } from '../types/index.js';

/** Options shared by the concat demuxer runs. */
export interface ConcatDemuxerOptions {
  /** Total duration of the joined output in seconds, used for the progress percentage. */
  duration?: number;
  /** Called with progress updates as the join advances. */
  onProgress?: (progress: Progress) => void;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/**
 * Joins `inputs` into `output` with the FFmpeg **concat demuxer** (`-f concat`)
 * and stream copy (`-c copy`) — no re-encode, so it's fast but requires every
 * input to share the same codecs and parameters.
 *
 * The demuxer reads a list file and resolves each entry relative to that file
 * unless it is absolute, so paths are resolved to absolute and single quotes are
 * escaped before being written. The temporary list file is always cleaned up.
 *
 * Shared by {@link parallelConvert} (joining re-encoded chunks) and the public
 * {@link concat} operation's `fast` mode.
 */
export async function concatDemuxer(
  inputs: string[],
  output: string,
  options: ConcatDemuxerOptions = {},
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'ffm-concat-'));
  try {
    const listFile = join(dir, 'list.txt');
    await writeFile(listFile, inputs.map(listEntry).join('\n'), 'utf8');

    await spawnFFmpeg({
      binary: resolveBinary('ffmpeg'),
      args: ['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-y', output],
      ...(options.duration !== undefined ? { duration: options.duration } : {}),
      ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Formats one concat-list line. The path is made absolute (the demuxer would
 * otherwise resolve it relative to the temp list file) and single quotes are
 * escaped using the demuxer's `'\''` convention.
 */
function listEntry(path: string): string {
  const abs = resolve(path).replace(/'/g, "'\\''");
  return `file '${abs}'`;
}
