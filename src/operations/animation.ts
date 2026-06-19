import { extname } from 'node:path';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { parseTimestamp } from '../core/time.js';
import { validateInput } from '../core/validate.js';
import { VIDEO_INPUT_FORMATS } from '../core/formats.js';
import { buildGifFilter, buildWebpFilter } from '../core/animation.js';
import { InvalidFormatError, InvalidOptionsError } from '../errors/index.js';
import type { AnimationOptions } from '../types/index.js';
import { probe } from './probe.js';

const DEFAULT_FPS = 15;
const DEFAULT_LOOP = 0;

/**
 * Encodes a range of a video into an animated image — a GIF or an animated WebP,
 * chosen from the output extension (`.gif` / `.webp`).
 *
 * GIFs use a per-clip generated palette (`palettegen`/`paletteuse`) for far better
 * quality than the default fixed palette; WebP is truecolour and skips it. The
 * clip defaults to the whole input at 15 fps; narrow it with `start`/`end` and
 * shrink it with `fps`/`width` to keep the file small.
 *
 * @param input - Path to the source video (MP4/MOV/WebM/MKV).
 * @param output - Path to the destination `.gif` or `.webp` file (overwritten if present).
 * @param options - Clip range, frame rate, width, loop count, and progress/abort options.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when `input` is not a supported video or `output` is not `.gif`/`.webp`.
 * @throws {InvalidOptionsError} when timestamps, `fps`, `width` or `loop` are out of range.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function toAnimation(
  input: string,
  output: string,
  options: AnimationOptions = {},
): Promise<void> {
  await validateInput(input, VIDEO_INPUT_FORMATS);

  const ext = extname(output).toLowerCase();
  if (ext !== '.gif' && ext !== '.webp') {
    throw new InvalidFormatError(output, `unsupported animation extension "${ext || '(none)'}" (expected .gif, .webp)`);
  }

  const fps = options.fps ?? DEFAULT_FPS;
  if (!(fps > 0)) {
    throw new InvalidOptionsError(`fps must be a positive number (got ${fps})`);
  }
  if (options.width !== undefined && (!Number.isInteger(options.width) || options.width <= 0)) {
    throw new InvalidOptionsError(`width must be a positive integer (got ${options.width})`);
  }
  const loop = options.loop ?? DEFAULT_LOOP;
  if (!Number.isInteger(loop)) {
    throw new InvalidOptionsError(`loop must be an integer (got ${loop})`);
  }

  const start = options.start !== undefined ? parseTimestamp(options.start, 'start') : 0;
  if (start < 0) {
    throw new InvalidOptionsError(`start must be >= 0 (got ${start}s)`);
  }
  let clipDuration: number | undefined;
  if (options.end !== undefined) {
    const end = parseTimestamp(options.end, 'end');
    if (end <= start) {
      throw new InvalidOptionsError(`end (${end}s) must be greater than start (${start}s)`);
    }
    clipDuration = end - start;
  }

  // The progress percentage needs a total time. When the clip is open-ended we
  // only probe the input (to derive it) if a caller is actually listening.
  let progressDuration = clipDuration;
  if (progressDuration === undefined && options.onProgress !== undefined) {
    progressDuration = (await probe(input)).duration - start;
  }

  const args = ['-ss', String(start), '-i', input];
  if (clipDuration !== undefined) args.push('-t', String(clipDuration));
  if (ext === '.gif') {
    args.push('-filter_complex', buildGifFilter(fps, options.width));
  } else {
    args.push('-vf', buildWebpFilter(fps, options.width), '-c:v', 'libwebp_anim');
  }
  args.push('-loop', String(loop), '-y', output);

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args,
    ...(progressDuration !== undefined ? { duration: progressDuration } : {}),
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}
