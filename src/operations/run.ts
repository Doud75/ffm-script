import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg, spawnFFmpegStream } from '../core/spawn.js';
import { InvalidOptionsError } from '../errors/index.js';
import type { RunOptions, RunStreamOptions } from '../types/index.js';

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

/**
 * Streaming counterpart to {@link run}: runs FFmpeg with an arbitrary argument
 * list, piping a Node `Readable` into its stdin and/or its stdout into a
 * `Writable`. Data is **never buffered in memory** — it flows straight through
 * the process — so very large files are handled with a bounded footprint.
 *
 * Same engine as `run` (progress, abort, timeout, typed errors), but resolves
 * with `void`: the bytes go to `output`, not the return value. Reference the
 * piped ends as `pipe:0` / `pipe:1` in `args`.
 *
 * A pipe is **not seekable**, so the args must use a streamable format — a
 * streamable container (MPEG-TS, Matroska) or fragmented MP4
 * (`-movflags frag_keyframe+empty_moov`) for piped output, and a
 * linearly-decodable input for piped input. A plain `moov`-at-end MP4 cannot be
 * read from or written to a pipe.
 *
 * @param args - Arguments passed straight to `ffmpeg` (without the binary itself).
 * @param options - `input`/`output` streams plus optional `duration`, `onProgress`, `signal`, `timeout`.
 * @throws {InvalidOptionsError} when `args` is empty.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 * @throws {FFmpegTimeoutError} when the run exceeds `timeout`.
 *
 * @example
 * await runStream(
 *   ['-i', 'pipe:0', '-c:v', 'libx264', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'],
 *   { input: req, output: res, onProgress: (p) => console.log(`${p.percent}%`) },
 * );
 */
export async function runStream(
  args: string[],
  options: RunStreamOptions = {},
): Promise<void> {
  if (args.length === 0) {
    throw new InvalidOptionsError('runStream requires at least one argument');
  }

  await spawnFFmpegStream({
    binary: resolveBinary('ffmpeg'),
    args,
    ...(options.input !== undefined ? { input: options.input } : {}),
    ...(options.output !== undefined ? { output: options.output } : {}),
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
  });
}
