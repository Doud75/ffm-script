import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { InvalidOptionsError } from '../errors/index.js';
import type { RunOptions } from '../types/index.js';

/**
 * Runs FFmpeg with an arbitrary argument list — the escape hatch for anything
 * the typed operations don't cover.
 *
 * The whole engine still applies: progress parsing, abort, timeout, and the
 * typed {@link FFmpegError} / {@link FFmpegNotFoundError} hierarchy. You own the
 * arguments verbatim, including the input(s), output, and any `-y` to overwrite
 * — nothing is added or rewritten.
 *
 * @param args - Arguments passed straight to `ffmpeg` (without the binary itself).
 * @param options - Optional `duration` (for progress), `onProgress`, `signal`, `timeout`.
 * @returns FFmpeg's captured stdout (usually empty unless you direct output to it).
 * @throws {InvalidOptionsError} when `args` is empty.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 * @throws {FFmpegTimeoutError} when the run exceeds `timeout`.
 *
 * @example
 * await run(['-i', 'input.mp4', '-vf', 'scale=1280:-2', '-crf', '18', '-y', 'out.mp4'], {
 *   duration: 124,
 *   onProgress: (p) => console.log(`${p.percent}%`),
 * });
 */
export async function run(args: string[], options: RunOptions = {}): Promise<string> {
  if (args.length === 0) {
    throw new InvalidOptionsError('run requires at least one argument');
  }

  return spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args,
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
  });
}
