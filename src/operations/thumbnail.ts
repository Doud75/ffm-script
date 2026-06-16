import { extname } from 'node:path';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { parseTimestamp } from '../core/time.js';
import { validateInput } from '../core/validate.js';
import { VIDEO_INPUT_FORMATS } from '../core/formats.js';
import { InvalidFormatError, InvalidOptionsError } from '../errors/index.js';
import type { ThumbnailOptions } from '../types/index.js';

const OUTPUT_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

/**
 * Captures a single frame from an MP4 file at a given timestamp, written as a
 * JPEG or PNG (chosen from the output extension).
 *
 * The timestamp accepts seconds (`number` or `"5.5"`) or `HH:MM:SS[.ms]`.
 *
 * @param input - Path to the source MP4 file.
 * @param output - Path to the destination image (`.jpg`, `.jpeg` or `.png`).
 * @param options - Timestamp and optional resize width.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when `input` is not `.mp4` or the output is not
 * a supported image extension.
 * @throws {InvalidOptionsError} when the timestamp is unparseable/negative or
 * `width` is not a positive integer.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function thumbnail(
  input: string,
  output: string,
  options: ThumbnailOptions,
): Promise<void> {
  await validateInput(input, VIDEO_INPUT_FORMATS);

  const ext = extname(output).toLowerCase();
  if (!OUTPUT_EXTENSIONS.includes(ext)) {
    throw new InvalidFormatError(
      output,
      `unsupported image extension "${ext || '(none)'}" (expected ${OUTPUT_EXTENSIONS.join(', ')})`,
    );
  }

  const timestamp = parseTimestamp(options.timestamp, 'timestamp');
  if (timestamp < 0) {
    throw new InvalidOptionsError(`timestamp must be >= 0 (got ${timestamp}s)`);
  }
  if (options.width !== undefined && (!Number.isInteger(options.width) || options.width <= 0)) {
    throw new InvalidOptionsError(`width must be a positive integer (got ${options.width})`);
  }

  // `-ss` before `-i` seeks fast; `-frames:v 1` captures a single frame.
  const args = ['-ss', String(timestamp), '-i', input, '-frames:v', '1'];
  if (options.width !== undefined) args.push('-vf', `scale=${options.width}:-2`);
  args.push('-y', output);

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}
