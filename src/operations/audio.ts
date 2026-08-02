import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg, spawnFFmpegCapture } from '../core/spawn.js';
import { validateInput } from '../core/validate.js';
import { ALL_INPUT_FORMATS, AUDIO_INPUT_FORMATS } from '../core/formats.js';
import { assertCodecAllowed, resolveOutputContainer } from '../core/container.js';
import {
  assertAudioOutput,
  buildSilenceRemoveFilter,
  isAudioOutput,
  resolveAudioEncoder,
} from '../core/audio.js';
import {
  DEFAULT_LOUDNORM_TARGETS,
  buildLoudnormFilter,
  offsetProgress,
  parseLoudnormStats,
  type LoudnormTargets,
} from '../core/loudnorm.js';
import { InvalidFormatError, InvalidOptionsError } from '../errors/index.js';
import type {
  AudioStream,
  NormalizeAudioOptions,
  ProbeResult,
  Progress,
  ResampleAudioOptions,
  TrimSilenceOptions,
} from '../types/index.js';
import { probe } from './probe.js';

/**
 * Normalizes loudness to an EBU R128 target using `loudnorm` in **two passes**:
 * the first measures the input, the second corrects it with those measurements
 * in hand. That is what makes the result transparent — a single pass has to ride
 * the level as it goes, which audibly pumps on material with any dynamics.
 *
 * Accepts video or audio input. A video stream is **copied** (`-c:v copy`) when
 * the output is a video container, so the picture survives untouched; it is
 * dropped when the output is audio-only.
 *
 * Costs roughly twice the wall time of a one-pass encode, since the input is
 * decoded twice. `onProgress` spans both passes as one 0–100 % timeline.
 *
 * @param input - Path to the source media file.
 * @param output - Path to the destination file; its extension picks the encoder.
 * @param options - Loudness targets, output encoding and progress/abort options.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when a format is unsupported, the input carries no audio, a codec is incompatible with the output container, or the analysis pass returns unparseable output.
 * @throws {InvalidOptionsError} when a loudness target or the sample rate is out of range.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function normalizeAudio(
  input: string,
  output: string,
  options: NormalizeAudioOptions = {},
): Promise<void> {
  await validateInput(input, ALL_INPUT_FORMATS);

  // Everything that can be rejected without running FFmpeg is rejected first.
  const targets = resolveTargets(options);
  const encoder = resolveAudioEncoder(output, options.audioCodec);
  if (options.sampleRate !== undefined) {
    assertRange(options.sampleRate, 'sampleRate', 8000, 192000, { integer: true });
  }

  const info = await probe(input);
  const audio = assertHasAudio(info, input);
  const video = videoArgs(info, output);
  const sampleRate = options.sampleRate ?? audio.sampleRate;
  const binary = resolveBinary('ffmpeg');

  // Both passes decode the whole input, so the combined timeline is twice as long.
  const total = info.duration * 2;
  const progressFor = (offset: number): ((p: Progress) => void) | undefined =>
    options.onProgress === undefined
      ? undefined
      : (p: Progress): void => {
          options.onProgress?.(offsetProgress(p, offset, total));
        };

  const analysisProgress = progressFor(0);
  const { stderr } = await spawnFFmpegCapture({
    binary,
    args: ['-i', input, '-af', buildLoudnormFilter(targets), '-f', 'null', '-'],
    duration: info.duration,
    ...(analysisProgress !== undefined ? { onProgress: analysisProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });

  // `null` means the input measured as silent (`-inf`); the correction pass
  // would reject those figures, so it falls back to one-pass dynamic mode.
  const measured = parseLoudnormStats(stderr, input);
  const filter =
    measured === null ? buildLoudnormFilter(targets) : buildLoudnormFilter(targets, measured);

  const args = ['-i', input, ...video, '-af', filter, '-ar', String(sampleRate), '-c:a', encoder];
  if (options.audioBitrate !== undefined) args.push('-b:a', options.audioBitrate);
  args.push('-y', output);

  const correctionProgress = progressFor(info.duration);
  await spawnFFmpeg({
    binary,
    args,
    duration: info.duration,
    ...(correctionProgress !== undefined ? { onProgress: correctionProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}

/**
 * Changes an audio stream's sample rate and/or channel layout (FFmpeg `-ar` /
 * `-ac`), leaving everything else alone.
 *
 * Accepts video or audio input; a video stream is copied when the output is a
 * video container, and dropped when it is audio-only.
 *
 * @param input - Path to the source media file.
 * @param output - Path to the destination file; its extension picks the encoder.
 * @param options - Sample rate and/or channel count, plus output encoding and progress/abort options.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when a format is unsupported, the input carries no audio, or a codec is incompatible with the output container.
 * @throws {InvalidOptionsError} when neither `sampleRate` nor `channels` is given, or one of them is out of range.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function resampleAudio(
  input: string,
  output: string,
  options: ResampleAudioOptions = {},
): Promise<void> {
  await validateInput(input, ALL_INPUT_FORMATS);

  if (options.sampleRate === undefined && options.channels === undefined) {
    throw new InvalidOptionsError('resampleAudio needs at least one of sampleRate or channels');
  }
  if (options.sampleRate !== undefined) {
    assertRange(options.sampleRate, 'sampleRate', 8000, 192000, { integer: true });
  }
  if (options.channels !== undefined) {
    assertRange(options.channels, 'channels', 1, 8, { integer: true });
  }
  const encoder = resolveAudioEncoder(output, options.audioCodec);

  // Probed for the video-copy decision; the duration also drives progress.
  const info = await probe(input);
  assertHasAudio(info, input);

  const args = ['-i', input, ...videoArgs(info, output)];
  if (options.sampleRate !== undefined) args.push('-ar', String(options.sampleRate));
  if (options.channels !== undefined) args.push('-ac', String(options.channels));
  args.push('-c:a', encoder);
  if (options.audioBitrate !== undefined) args.push('-b:a', options.audioBitrate);
  args.push('-y', output);

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args,
    duration: info.duration,
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}

/**
 * Removes silence from an audio file (FFmpeg `silenceremove`) — the leading and
 * trailing silence by default, every silent stretch with `mode: 'all'`.
 *
 * **Audio in, audio out.** Cutting the audio timeline without cutting the
 * picture to match would desynchronise them, so video is rejected outright
 * rather than silently ruined.
 *
 * There is no `onProgress`: the output is shorter than the input by design, so
 * FFmpeg's own timestamps run against a timeline whose length isn't known until
 * the run ends, and any percentage derived from them would be wrong.
 *
 * @param input - Path to the source audio file.
 * @param output - Path to the destination audio file.
 * @param options - Detection thresholds, mode and output encoding options.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when `input` or `output` is not an audio-only format.
 * @throws {InvalidOptionsError} when `mode` is unknown or a threshold/duration is out of range.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function trimSilence(
  input: string,
  output: string,
  options: TrimSilenceOptions = {},
): Promise<void> {
  await validateInput(input, AUDIO_INPUT_FORMATS);
  assertAudioOutput(output);

  const mode = options.mode ?? 'both';
  if (!['start', 'end', 'both', 'all'].includes(mode)) {
    throw new InvalidOptionsError(
      `mode must be one of 'start', 'end', 'both', 'all' (got "${mode}")`,
    );
  }

  const threshold = options.threshold ?? -50;
  if (threshold > 0) {
    throw new InvalidOptionsError(`threshold must be a negative dB value (got ${threshold})`);
  }
  const minDuration = options.minDuration ?? 1;
  assertRange(minDuration, 'minDuration', 0, 3600);
  const keepSilence = options.keepSilence ?? 0;
  assertRange(keepSilence, 'keepSilence', 0, 3600);

  const encoder = resolveAudioEncoder(output, options.audioCodec);
  const filter = buildSilenceRemoveFilter({ threshold, minDuration, keepSilence, mode });

  const args = ['-i', input, '-af', filter, '-c:a', encoder];
  if (options.audioBitrate !== undefined) args.push('-b:a', options.audioBitrate);
  args.push('-y', output);

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}

/** Applies the loudnorm defaults and range-checks whatever the caller overrode. */
function resolveTargets(options: NormalizeAudioOptions): LoudnormTargets {
  const targets: LoudnormTargets = {
    targetLoudness: options.targetLoudness ?? DEFAULT_LOUDNORM_TARGETS.targetLoudness,
    truePeak: options.truePeak ?? DEFAULT_LOUDNORM_TARGETS.truePeak,
    loudnessRange: options.loudnessRange ?? DEFAULT_LOUDNORM_TARGETS.loudnessRange,
  };

  assertRange(targets.targetLoudness, 'targetLoudness', -70, -5);
  assertRange(targets.truePeak, 'truePeak', -9, 0);
  assertRange(targets.loudnessRange, 'loudnessRange', 1, 50);
  return targets;
}

/**
 * Guards the operations that only make sense on sound.
 *
 * @throws {InvalidFormatError} when the input carries no audio stream — caught
 * here so a silent video fails on its own terms instead of on FFmpeg's.
 */
function assertHasAudio(info: ProbeResult, input: string): AudioStream {
  if (info.audio === null) {
    throw new InvalidFormatError(input, 'no audio stream to work on');
  }
  return info.audio;
}

/**
 * How the source video stream travels to the output: copied verbatim into a
 * video container, dropped when the output is audio-only.
 *
 * @throws {InvalidFormatError} when the copied video codec can't be muxed into
 * the output container (e.g. h264 into WebM) — caught here rather than left to
 * surface as an opaque FFmpeg failure halfway through the run.
 */
function videoArgs(info: ProbeResult, output: string): string[] {
  if (isAudioOutput(output)) return ['-vn'];
  if (info.video === null) return [];

  const { config } = resolveOutputContainer(output);
  assertCodecAllowed(config, info.video.codec, 'video', output);
  return ['-c:v', 'copy'];
}

function assertRange(
  value: number,
  label: string,
  min: number,
  max: number,
  options: { integer?: boolean } = {},
): void {
  if (options.integer === true && !Number.isInteger(value)) {
    throw new InvalidOptionsError(`${label} must be an integer (got ${value})`);
  }
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new InvalidOptionsError(`${label} must be between ${min} and ${max} (got ${value})`);
  }
}
