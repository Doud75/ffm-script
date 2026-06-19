import { extname } from 'node:path';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { concatDemuxer } from '../core/concat.js';
import { validateInput } from '../core/validate.js';
import { VIDEO_INPUT_FORMATS } from '../core/formats.js';
import { InvalidFormatError, InvalidOptionsError } from '../errors/index.js';
import type { ConcatOptions, ProbeResult, Progress } from '../types/index.js';
import { probe } from './probe.js';

const DEFAULT_VIDEO_CODEC = 'libx264';
const DEFAULT_AUDIO_CODEC = 'aac';

/**
 * Concatenates several video files into a single MP4.
 *
 * FFmpeg offers two concat mechanisms and the classic trap is picking the wrong
 * one — see {@link ConcatOptions.mode}. `'auto'` (the default) probes the inputs
 * and chooses: stream-copy `'fast'` when they are compatible, re-encoding
 * `'precise'` when they are not.
 *
 * @param inputs - Two or more source video files (MP4/MOV/WebM/MKV), joined in order.
 * @param output - Path to the destination `.mp4` file (overwritten if present).
 * @param options - Join mode and progress/abort options.
 * @throws {InvalidOptionsError} when fewer than two inputs are given, or `precise`
 * is needed but the inputs disagree on whether they carry an audio track.
 * @throws {FileNotFoundError} when an input does not exist.
 * @throws {InvalidFormatError} when an input is not a supported video format or `output` is not `.mp4`.
 * @throws {FFmpegError} when FFmpeg exits with a non-zero code.
 */
export async function concat(
  inputs: string[],
  output: string,
  options: ConcatOptions = {},
): Promise<void> {
  if (inputs.length < 2) {
    throw new InvalidOptionsError(`concat needs at least two inputs (got ${inputs.length})`);
  }
  for (const input of inputs) {
    await validateInput(input, VIDEO_INPUT_FORMATS);
  }
  if (extname(output).toLowerCase() !== '.mp4') {
    throw new InvalidFormatError(output, 'output must be an .mp4 file');
  }

  const mode = options.mode ?? 'auto';

  // Probe when we need to (auto-detection, precise needs to know the audio
  // layout) or when progress is requested (to derive the total duration). A
  // plain `fast` join with no progress skips probing entirely — that's the point.
  const infos =
    mode === 'auto' || mode === 'precise' || options.onProgress !== undefined
      ? await Promise.all(inputs.map((input) => probe(input)))
      : undefined;

  const resolvedMode = mode === 'auto' ? (areCompatible(infos!) ? 'fast' : 'precise') : mode;

  const duration = infos?.reduce((sum, info) => sum + info.duration, 0);
  const progress: ProgressOptions = {
    ...(duration !== undefined ? { duration } : {}),
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };

  if (resolvedMode === 'fast') {
    await concatDemuxer(inputs, output, progress);
  } else {
    await concatFilter(inputs, output, infos!, progress);
  }
}

interface ProgressOptions {
  duration?: number;
  onProgress?: (progress: Progress) => void;
  signal?: AbortSignal;
}

/**
 * Inputs are concat-demuxer compatible when every one shares the same video
 * codec and resolution and the same audio layout (codec, sample rate, channels,
 * including the absence of audio). Otherwise a stream copy would corrupt the join.
 */
function areCompatible(infos: ProbeResult[]): boolean {
  const [first, ...rest] = infos;
  if (first === undefined) return true;
  return rest.every(
    (info) =>
      info.video?.codec === first.video?.codec &&
      info.video?.width === first.video?.width &&
      info.video?.height === first.video?.height &&
      (info.audio?.codec ?? null) === (first.audio?.codec ?? null) &&
      (info.audio?.sampleRate ?? null) === (first.audio?.sampleRate ?? null) &&
      (info.audio?.channels ?? null) === (first.audio?.channels ?? null),
  );
}

/**
 * Joins heterogeneous inputs with the concat **filter**, re-encoding the result.
 * Every input must agree on whether it has audio: the filter graph wires a fixed
 * number of streams per segment, so a missing track on one input would break it.
 */
async function concatFilter(
  inputs: string[],
  output: string,
  infos: ProbeResult[],
  options: ProgressOptions,
): Promise<void> {
  const withAudio = infos.filter((info) => info.audio !== null).length;
  if (withAudio !== 0 && withAudio !== inputs.length) {
    throw new InvalidOptionsError(
      'precise concat needs every input to either have or lack an audio track; mixing the two is not supported',
    );
  }
  const hasAudio = withAudio === inputs.length;

  const args: string[] = [];
  for (const input of inputs) args.push('-i', input);

  // [0:v:0][0:a:0][1:v:0][1:a:0]...concat=n=N:v=1:a=1[outv][outa]
  const labels = inputs
    .map((_, i) => (hasAudio ? `[${i}:v:0][${i}:a:0]` : `[${i}:v:0]`))
    .join('');
  const filter =
    `${labels}concat=n=${inputs.length}:v=1:a=${hasAudio ? 1 : 0}[outv]` +
    (hasAudio ? '[outa]' : '');

  args.push('-filter_complex', filter, '-map', '[outv]');
  if (hasAudio) args.push('-map', '[outa]');
  args.push('-c:v', DEFAULT_VIDEO_CODEC);
  if (hasAudio) args.push('-c:a', DEFAULT_AUDIO_CODEC);
  args.push('-y', output);

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args,
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}
