import { extname } from 'node:path';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { validateInput } from '../core/validate.js';
import { VIDEO_INPUT_FORMATS, IMAGE_INPUT_FORMATS } from '../core/formats.js';
import { buildOverlayFilter } from '../core/overlay.js';
import { InvalidFormatError, InvalidOptionsError } from '../errors/index.js';
import type { OverlayOptions } from '../types/index.js';
import { probe } from './probe.js';

const DEFAULT_POSITION = 'bottom-right' as const;
const DEFAULT_MARGIN = 10;
const DEFAULT_OPACITY = 1;

/**
 * Overlays a watermark image onto a video, writing an MP4.
 *
 * The watermark is anchored to a corner (or the centre), optionally scaled to a
 * width and faded with an opacity. The video is re-encoded (`libx264`) since the
 * picture changes; the audio is stream-copied unchanged.
 *
 * @param input - Path to the source video (MP4/MOV/WebM/MKV).
 * @param output - Path to the destination `.mp4` file (overwritten if present).
 * @param options - Watermark path, position, margin, opacity, width and progress/abort options.
 * @throws {FileNotFoundError} when `input` or the watermark does not exist.
 * @throws {InvalidFormatError} when `input`/watermark is not a supported format or `output` is not `.mp4`.
 * @throws {InvalidOptionsError} when `opacity`, `margin` or `width` are out of range.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function overlay(
  input: string,
  output: string,
  options: OverlayOptions,
): Promise<void> {
  await validateInput(input, VIDEO_INPUT_FORMATS);
  await validateInput(options.watermark, IMAGE_INPUT_FORMATS);
  if (extname(output).toLowerCase() !== '.mp4') {
    throw new InvalidFormatError(output, 'output must be an .mp4 file');
  }

  const opacity = options.opacity ?? DEFAULT_OPACITY;
  if (opacity < 0 || opacity > 1) {
    throw new InvalidOptionsError(`opacity must be between 0 and 1 (got ${opacity})`);
  }
  const margin = options.margin ?? DEFAULT_MARGIN;
  if (!Number.isInteger(margin) || margin < 0) {
    throw new InvalidOptionsError(`margin must be a non-negative integer (got ${margin})`);
  }
  if (options.width !== undefined && (!Number.isInteger(options.width) || options.width <= 0)) {
    throw new InvalidOptionsError(`width must be a positive integer (got ${options.width})`);
  }

  const filter = buildOverlayFilter({
    position: options.position ?? DEFAULT_POSITION,
    margin,
    opacity,
    width: options.width,
  });

  const duration =
    options.onProgress !== undefined ? (await probe(input)).duration : undefined;

  // `-map 0:a?` copies the original audio when present (the `?` makes it optional,
  // so a silent video doesn't fail); only the video is re-encoded.
  const args = [
    '-i', input,
    '-i', options.watermark,
    '-filter_complex', filter,
    '-map', '[out]',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-c:a', 'copy',
    '-y', output,
  ];

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args,
    ...(duration !== undefined ? { duration } : {}),
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}
