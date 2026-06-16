import { extname } from 'node:path';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { parseTimestamp } from '../core/time.js';
import { validateInput } from '../core/validate.js';
import { InvalidFormatError, InvalidOptionsError } from '../errors/index.js';
import type { TrimOptions } from '../types/index.js';

/**
 * Cuts a section out of an MP4 file between `start` and `end`.
 *
 * Timestamps accept seconds (`number` or `"5.5"`) or `HH:MM:SS[.ms]` strings.
 *
 * Modes (see {@link TrimOptions.mode}):
 * - `'fast'` (default): stream copy (`-c copy`), no re-encode. The cut snaps to
 *   the nearest keyframe **before** `start`, so the real start may be slightly
 *   earlier depending on the GOP size — fast but not frame-accurate.
 * - `'precise'`: re-encodes from the seek point for a frame-accurate cut, at the
 *   cost of being significantly slower.
 *
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when `input`/`output` is not an `.mp4` file.
 * @throws {InvalidOptionsError} when timestamps are unparseable or `end <= start`.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function trim(
  input: string,
  output: string,
  options: TrimOptions,
): Promise<void> {
  await validateInput(input, ['.mp4']);
  if (extname(output).toLowerCase() !== '.mp4') {
    throw new InvalidFormatError(output, 'output must be an .mp4 file');
  }

  const start = parseTimestamp(options.start, 'start');
  const end = parseTimestamp(options.end, 'end');
  if (start < 0) {
    throw new InvalidOptionsError(`trim start must be >= 0 (got ${start}s)`);
  }
  if (end <= start) {
    throw new InvalidOptionsError(`trim end (${end}s) must be greater than start (${start}s)`);
  }
  const duration = end - start;

  // 'fast' copies streams (keyframe-bound); 'precise' re-encodes for accuracy.
  const codecArgs =
    (options.mode ?? 'fast') === 'fast'
      ? ['-c', 'copy']
      : ['-c:v', 'libx264', '-c:a', 'aac'];

  // `-ss` before `-i` seeks the input fast; `-t` bounds the output length.
  // `-to` is avoided: with input seeking it is measured from the seek point.
  const args = [
    '-ss', String(start),
    '-i', input,
    '-t', String(duration),
    ...codecArgs,
    '-y', output,
  ];

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args,
    duration,
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}
