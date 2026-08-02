import { extname } from 'node:path';
import { InvalidFormatError } from '../errors/index.js';
import { VIDEO_INPUT_FORMATS } from './formats.js';
import { resolveOutputContainer, assertCodecAllowed } from './container.js';
import type { SilenceMode } from '../types/index.js';

/**
 * Audio-only output extensions mapped to the FFmpeg encoder that writes them.
 *
 * A superset of the private table in `operations/extract.ts`, which stays put:
 * its public `codec?: 'mp3' | 'aac'` option is part of the frozen 1.x surface,
 * whereas the audio toolkit also writes lossless targets.
 */
export const AUDIO_ENCODERS: Record<string, string> = {
  '.mp3': 'libmp3lame',
  '.aac': 'aac',
  '.m4a': 'aac',
  '.wav': 'pcm_s16le',
  '.flac': 'flac',
};

/** Every audio-only output extension the toolkit can write. */
export const AUDIO_OUTPUT_FORMATS: string[] = Object.keys(AUDIO_ENCODERS);

/** Whether the output path names an audio-only container. */
export function isAudioOutput(output: string): boolean {
  return AUDIO_OUTPUT_FORMATS.includes(extname(output).toLowerCase());
}

/**
 * Rejects an output that is not an audio-only container.
 *
 * @throws {InvalidFormatError} when the extension is missing or carries video.
 */
export function assertAudioOutput(output: string): void {
  if (isAudioOutput(output)) return;
  const ext = extname(output).toLowerCase();
  throw new InvalidFormatError(
    output,
    `expected an audio-only output (${AUDIO_OUTPUT_FORMATS.join(', ')}), got "${ext || '(none)'}"`,
  );
}

/**
 * Resolves the FFmpeg `-c:a` encoder for an output path, whether it is an
 * audio-only file or a video container whose video stream is being copied.
 *
 * Video containers reuse the muxing matrix in `container.ts`, so an audio codec
 * the container can't carry (e.g. AAC into WebM) is rejected here rather than
 * surfacing as an opaque FFmpeg failure.
 *
 * @throws {InvalidFormatError} when the extension is supported by neither table,
 * or when an explicit `audioCodec` is incompatible with a video container.
 */
export function resolveAudioEncoder(output: string, audioCodec?: string): string {
  const ext = extname(output).toLowerCase();

  const audioEncoder = AUDIO_ENCODERS[ext];
  if (audioEncoder !== undefined) return audioCodec ?? audioEncoder;

  if (VIDEO_INPUT_FORMATS.includes(ext)) {
    const { config } = resolveOutputContainer(output);
    const encoder = audioCodec ?? config.defaultAudioCodec;
    assertCodecAllowed(config, encoder, 'audio', output);
    return encoder;
  }

  const supported = [...AUDIO_OUTPUT_FORMATS, ...VIDEO_INPUT_FORMATS].join(', ');
  throw new InvalidFormatError(
    output,
    `unsupported audio output "${ext || '(none)'}" (expected ${supported})`,
  );
}

/** Resolved `silenceremove` settings, defaults already applied. */
export interface SilenceRemoveParams {
  /** Level below which audio counts as silence, in dB. */
  threshold: number;
  /** How much silence every interior stretch is shortened to, in seconds (`'all'` only). */
  minDuration: number;
  /** Silence left in place at the head of the stream, in seconds. */
  keepSilence: number;
  /** Which silences to remove. */
  mode: SilenceMode;
}

/**
 * Builds the audio filter chain that strips silence.
 *
 * The edge modes lean on `areverse`: `silenceremove` only ever trims from the
 * *head* of a stream, so removing trailing silence means reversing the audio,
 * trimming its new head, and reversing back.
 *
 * `'all'` needs both halves of the filter — `stop_periods=-1` sweeps every
 * silence from the first non-silent sample onward (the trailing one included),
 * but it never touches what comes before that sample, which is what
 * `start_periods=1` is for.
 */
export function buildSilenceRemoveFilter(params: SilenceRemoveParams): string {
  const { threshold, minDuration, keepSilence, mode } = params;

  const head = [
    'silenceremove=start_periods=1',
    `start_silence=${keepSilence}`,
    `start_threshold=${threshold}dB`,
  ].join(':');

  switch (mode) {
    case 'start':
      return head;
    case 'end':
      return `areverse,${head},areverse`;
    case 'both':
      return `${head},areverse,${head},areverse`;
    case 'all':
      return [
        head,
        'stop_periods=-1',
        `stop_duration=${minDuration}`,
        `stop_threshold=${threshold}dB`,
      ].join(':');
  }
}
