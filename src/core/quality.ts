import { InvalidOptionsError } from '../errors/index.js';
import type { Quality } from '../types/index.js';

/**
 * Encoder families that map a semantic {@link Quality} onto a constant-quality
 * mode. Every encoder exposes that dial under a different flag and on a
 * different scale, so the presets are calibrated per family rather than assuming
 * x264's `-crf` everywhere.
 */
type Family =
  'x26x' | 'nvenc' | 'qsv' | 'videotoolbox' | 'vaapi' | 'amf' | 'vp9' | 'svtav1' | 'aomav1';

/**
 * Per-family FFmpeg arguments for each preset.
 *
 * - **x26x** — `-crf` (quality/size dial, lower is better) plus `-preset`
 *   (speed vs compression efficiency).
 * - **nvenc/qsv/vaapi/amf** — the hardware equivalents of CRF: `-cq`,
 *   `-global_quality`, `-qp`, and AMF's constant-QP mode respectively.
 * - **videotoolbox** — `-q:v` on an *inverted* 0-100 scale: higher is better.
 * - **vp9/aomav1** — CRF needs an explicit `-b:v 0` to select constant quality;
 *   without it libvpx/libaom treat the CRF as a cap on a bitrate-targeting run.
 * - **svtav1** — CRF plus a numeric `-preset` (higher is faster).
 */
const PRESETS: Record<Family, Record<Quality, readonly string[]>> = {
  x26x: {
    high: ['-crf', '18', '-preset', 'slow'],
    balanced: ['-crf', '23', '-preset', 'medium'],
    small: ['-crf', '28', '-preset', 'medium'],
  },
  nvenc: {
    high: ['-cq', '19', '-preset', 'p6'],
    balanced: ['-cq', '23', '-preset', 'p4'],
    small: ['-cq', '28', '-preset', 'p4'],
  },
  qsv: {
    high: ['-global_quality', '19'],
    balanced: ['-global_quality', '23'],
    small: ['-global_quality', '28'],
  },
  videotoolbox: {
    high: ['-q:v', '65'],
    balanced: ['-q:v', '55'],
    small: ['-q:v', '40'],
  },
  vaapi: {
    high: ['-qp', '19'],
    balanced: ['-qp', '23'],
    small: ['-qp', '28'],
  },
  amf: {
    high: ['-rc', 'cqp', '-qp_i', '19', '-qp_p', '19'],
    balanced: ['-rc', 'cqp', '-qp_i', '23', '-qp_p', '23'],
    small: ['-rc', 'cqp', '-qp_i', '28', '-qp_p', '28'],
  },
  vp9: {
    high: ['-crf', '24', '-b:v', '0'],
    balanced: ['-crf', '31', '-b:v', '0'],
    small: ['-crf', '37', '-b:v', '0'],
  },
  svtav1: {
    high: ['-crf', '28', '-preset', '6'],
    balanced: ['-crf', '35', '-preset', '8'],
    small: ['-crf', '45', '-preset', '8'],
  },
  aomav1: {
    high: ['-crf', '25', '-b:v', '0', '-cpu-used', '4'],
    balanced: ['-crf', '32', '-b:v', '0', '-cpu-used', '5'],
    small: ['-crf', '40', '-b:v', '0', '-cpu-used', '6'],
  },
};

/** Software encoders (and codec aliases) matched by exact name. */
const ENCODER_FAMILY: Record<string, Family> = {
  libx264: 'x26x',
  libx264rgb: 'x26x',
  h264: 'x26x',
  libx265: 'x26x',
  hevc: 'x26x',
  h265: 'x26x',
  'libvpx-vp9': 'vp9',
  vp9: 'vp9',
  libsvtav1: 'svtav1',
  'libaom-av1': 'aomav1',
};

/**
 * Hardware encoders, matched by suffix: FFmpeg names them `<codec>_<api>`
 * (`h264_nvenc`, `hevc_nvenc`, `av1_nvenc`…), and every encoder sharing an API
 * takes the same quality flag — so one rule covers the whole family, including
 * codecs added to it by a future FFmpeg.
 */
const HARDWARE_FAMILIES: readonly (readonly [string, Family])[] = [
  ['_nvenc', 'nvenc'],
  ['_qsv', 'qsv'],
  ['_videotoolbox', 'videotoolbox'],
  ['_vaapi', 'vaapi'],
  ['_amf', 'amf'],
];

/** The encoder family whose preset scale applies, or `undefined` if unknown. */
function familyOf(encoder: string): Family | undefined {
  const exact = ENCODER_FAMILY[encoder];
  if (exact !== undefined) return exact;
  return HARDWARE_FAMILIES.find(([suffix]) => encoder.endsWith(suffix))?.[1];
}

/**
 * FFmpeg arguments implementing a semantic quality preset on `encoder`.
 *
 * @param quality - The requested preset.
 * @param encoder - The resolved `-c:v` encoder the preset must be expressed for.
 * @throws {InvalidOptionsError} when no preset scale is known for `encoder` —
 * pushing x264's `-crf` at an encoder that doesn't take it would only produce a
 * raw FFmpeg failure, so the caller is told to use `videoBitrate` instead.
 */
export function qualityArgs(quality: Quality, encoder: string): string[] {
  const family = familyOf(encoder);
  if (family === undefined) {
    throw new InvalidOptionsError(
      `no quality preset scale is known for the encoder "${encoder}"; use videoBitrate instead. ` +
        'Presets cover libx264/libx265, libvpx-vp9, libsvtav1/libaom-av1, and the ' +
        '*_nvenc / *_qsv / *_videotoolbox / *_vaapi / *_amf hardware encoders',
    );
  }
  return [...PRESETS[family][quality]];
}

/**
 * Rejects combining a `quality` preset with an explicit video bitrate. Constant
 * quality (CRF and its hardware equivalents) and `-b:v` (target a size) are
 * opposite encoding modes; passing both is contradictory, so callers must pick one.
 *
 * @throws {InvalidOptionsError} when both are set.
 */
export function assertQualityBitrateExclusive(
  quality: Quality | undefined,
  videoBitrate: string | undefined,
): void {
  if (quality !== undefined && videoBitrate !== undefined) {
    throw new InvalidOptionsError(
      'quality and an explicit video bitrate are mutually exclusive: ' +
        'quality uses constant quality, a bitrate targets a size — set only one',
    );
  }
}
