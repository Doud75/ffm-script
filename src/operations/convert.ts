import { extname } from 'node:path';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { validateInput } from '../core/validate.js';
import { VIDEO_INPUT_FORMATS } from '../core/formats.js';
import { buildScaleFilter } from '../core/scale.js';
import { qualityArgs, assertQualityBitrateExclusive } from '../core/quality.js';
import { InvalidFormatError } from '../errors/index.js';
import type { ConvertOptions } from '../types/index.js';
import { probe } from './probe.js';

const DEFAULT_VIDEO_CODEC = 'libx264';
const DEFAULT_AUDIO_CODEC = 'aac';

/**
 * Transcodes a video file (MP4/MOV/WebM/MKV) to an MP4 file.
 *
 * Sensible defaults are used when codecs are omitted (`libx264` / `aac`).
 * When `onProgress` is provided, the input is probed first to derive its
 * duration so progress can be reported as a percentage.
 *
 * @param input - Path to the source video file.
 * @param output - Path to the destination MP4 file (overwritten if present).
 * @param options - Codec, bitrate, resolution and progress options.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when `input` is not a supported video format or `output` is not `.mp4`.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function convert(
  input: string,
  output: string,
  options: ConvertOptions = {},
): Promise<void> {
  await validateInput(input, VIDEO_INPUT_FORMATS);
  if (extname(output).toLowerCase() !== '.mp4') {
    throw new InvalidFormatError(output, 'output must be an .mp4 file');
  }
  assertQualityBitrateExclusive(options.quality, options.videoBitrate);

  const duration =
    options.onProgress !== undefined ? (await probe(input)).duration : undefined;

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args: buildArgs(input, output, options),
    ...(duration !== undefined ? { duration } : {}),
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}

function buildArgs(input: string, output: string, options: ConvertOptions): string[] {
  const args = ['-i', input];

  args.push('-c:v', options.videoCodec ?? DEFAULT_VIDEO_CODEC);
  args.push('-c:a', options.audioCodec ?? DEFAULT_AUDIO_CODEC);

  if (options.quality !== undefined) args.push(...qualityArgs(options.quality));
  if (options.videoBitrate !== undefined) args.push('-b:v', options.videoBitrate);
  if (options.audioBitrate !== undefined) args.push('-b:a', options.audioBitrate);

  const scale = buildScaleFilter(options.width, options.height);
  if (scale !== undefined) args.push('-vf', scale);

  // Overwrite the output without prompting on stdin.
  args.push('-y', output);
  return args;
}
