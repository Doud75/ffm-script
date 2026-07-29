import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { validateInput } from '../core/validate.js';
import { VIDEO_INPUT_FORMATS } from '../core/formats.js';
import { buildScaleFilter } from '../core/scale.js';
import { qualityArgs, assertQualityBitrateExclusive } from '../core/quality.js';
import { buildHwaccelArgs } from '../core/hwaccel.js';
import {
  resolveOutputContainer,
  assertCodecAllowed,
  type ContainerConfig,
} from '../core/container.js';
import type { ConvertOptions } from '../types/index.js';
import { probe } from './probe.js';

/**
 * Transcodes a video file (MP4/MOV/WebM/MKV) to a video file, with the output
 * container chosen from the output extension (`.mp4`, `.mov`, `.mkv`, `.webm`).
 *
 * Codecs default to the container's natural pair when omitted — `libx264`/`aac`
 * for MP4/MOV/MKV, `libvpx-vp9`/`libopus` for WebM. An explicit codec that the
 * container can't carry (e.g. h264 into WebM) is rejected. When `onProgress` is
 * provided, the input is probed first to derive its duration so progress can be
 * reported as a percentage.
 *
 * Set `hwaccel` to decode the input on the GPU, and pair it with a hardware
 * encoder (`videoCodec: 'h264_nvenc'`, `'h264_videotoolbox'`, …) to move the
 * encode there too — `quality` presets are calibrated per encoder family, so the
 * same `quality: 'balanced'` works across them.
 *
 * @param input - Path to the source video file.
 * @param output - Path to the destination file; its extension picks the container.
 * @param options - Codec, bitrate, resolution, hardware acceleration and progress options.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when `input` is not a supported video format, the output extension matches no container, or a chosen codec is incompatible with it.
 * @throws {InvalidOptionsError} when `quality` is combined with a bitrate or with an encoder that has no known preset scale.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function convert(
  input: string,
  output: string,
  options: ConvertOptions = {},
): Promise<void> {
  await validateInput(input, VIDEO_INPUT_FORMATS);
  const { config } = resolveOutputContainer(output);

  const videoCodec = options.videoCodec ?? config.defaultVideoCodec;
  const audioCodec = options.audioCodec ?? config.defaultAudioCodec;
  assertCodecAllowed(config, videoCodec, 'video', output);
  assertCodecAllowed(config, audioCodec, 'audio', output);

  assertQualityBitrateExclusive(options.quality, options.videoBitrate);

  // Built before the probe below so an invalid option fails without spawning anything.
  const args = buildArgs(input, output, options, config, videoCodec, audioCodec);
  const duration = options.onProgress !== undefined ? (await probe(input)).duration : undefined;

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args,
    ...(duration !== undefined ? { duration } : {}),
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}

function buildArgs(
  input: string,
  output: string,
  options: ConvertOptions,
  config: ContainerConfig,
  videoCodec: string,
  audioCodec: string,
): string[] {
  // Hardware decoding is an *input* option: it applies to the file that follows.
  const args = [...buildHwaccelArgs(options.hwaccel), '-i', input];

  args.push('-c:v', videoCodec);
  // Codec-specific defaults (e.g. VP9 speed flags) only apply when the caller
  // kept the container's default codec — an explicit override owns its tuning.
  if (options.videoCodec === undefined && config.defaultVideoCodecArgs !== undefined) {
    args.push(...config.defaultVideoCodecArgs);
  }
  args.push('-c:a', audioCodec);

  if (options.quality !== undefined) args.push(...qualityArgs(options.quality, videoCodec));
  if (options.videoBitrate !== undefined) args.push('-b:v', options.videoBitrate);
  if (options.audioBitrate !== undefined) args.push('-b:a', options.audioBitrate);

  const scale = buildScaleFilter(options.width, options.height);
  if (scale !== undefined) args.push('-vf', scale);

  // Overwrite the output without prompting on stdin.
  args.push('-y', output);
  return args;
}
