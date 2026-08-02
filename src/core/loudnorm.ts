import { InvalidFormatError } from '../errors/index.js';
import type { Progress } from '../types/index.js';

/** EBU R128 targets, in the units FFmpeg's `loudnorm` filter expects. */
export interface LoudnormTargets {
  /** Integrated loudness target in LUFS (filter `I`). */
  targetLoudness: number;
  /** True-peak ceiling in dBTP (filter `TP`). */
  truePeak: number;
  /** Loudness range in LU (filter `LRA`). */
  loudnessRange: number;
}

/**
 * Defaults tuned for streaming and podcast delivery rather than for broadcast:
 * -16 LUFS is what music and speech platforms normalise to, where EBU R128's
 * -23 LUFS would land noticeably quiet next to everything else in a feed.
 */
export const DEFAULT_LOUDNORM_TARGETS: LoudnormTargets = {
  targetLoudness: -16,
  truePeak: -1.5,
  loudnessRange: 11,
};

/** The measurements the analysis pass prints as JSON on stderr. */
export interface LoudnormStats {
  /** Measured integrated loudness, LUFS. */
  inputI: number;
  /** Measured true peak, dBTP. */
  inputTP: number;
  /** Measured loudness range, LU. */
  inputLRA: number;
  /** Measured gating threshold, LUFS. */
  inputThresh: number;
  /** Offset the filter asks the second pass to apply, LU. */
  targetOffset: number;
}

/** Keys the analysis JSON must carry for the report to be usable. */
const STAT_KEYS = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'];

// loudnorm's JSON has no nested objects, so the last flat {...} block in stderr
// is the report — anything before it is FFmpeg's usual banner and stream dump.
const JSON_BLOCK_RE = /\{[^{}]*\}/g;

/**
 * Builds the `loudnorm` filter string.
 *
 * Without `measured`, this is the **analysis** pass: it only asks the filter to
 * print what it found. With `measured`, it is the **correction** pass — feeding
 * the measurements back lets the filter apply a single linear gain over the
 * whole file instead of riding the level dynamically, which is what makes the
 * two-pass form transparent where the one-pass form audibly pumps.
 */
export function buildLoudnormFilter(targets: LoudnormTargets, measured?: LoudnormStats): string {
  const params = [
    `I=${targets.targetLoudness}`,
    `TP=${targets.truePeak}`,
    `LRA=${targets.loudnessRange}`,
  ];

  if (measured === undefined) {
    params.push('print_format=json');
    return `loudnorm=${params.join(':')}`;
  }

  params.push(
    `measured_I=${measured.inputI}`,
    `measured_TP=${measured.inputTP}`,
    `measured_LRA=${measured.inputLRA}`,
    `measured_thresh=${measured.inputThresh}`,
    `offset=${measured.targetOffset}`,
    'linear=true',
  );
  return `loudnorm=${params.join(':')}`;
}

/**
 * Extracts the analysis pass's measurements from its stderr.
 *
 * @returns The parsed measurements, or `null` when any of them is not finite —
 * FFmpeg reports `-inf` for a silent (or near-silent) input, and feeding that
 * back as `measured_I` makes the correction pass fail. Callers fall back to
 * one-pass dynamic normalisation instead of erroring out.
 * @throws {InvalidFormatError} when stderr carries no parseable report at all.
 */
export function parseLoudnormStats(stderr: string, input: string): LoudnormStats | null {
  const blocks = stderr.match(JSON_BLOCK_RE);
  const last = blocks?.[blocks.length - 1];
  const raw = last === undefined ? undefined : parseJson(last);

  if (raw === undefined || !STAT_KEYS.every((key) => key in raw)) {
    throw new InvalidFormatError(input, 'loudnorm analysis returned unparseable output');
  }

  const stats: LoudnormStats = {
    inputI: Number(raw.input_i),
    inputTP: Number(raw.input_tp),
    inputLRA: Number(raw.input_lra),
    inputThresh: Number(raw.input_thresh),
    targetOffset: Number(raw.target_offset),
  };

  return Object.values(stats).every((value) => Number.isFinite(value)) ? stats : null;
}

/** The block always starts with `{`, so a successful parse is always an object. */
function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Rebases one pass's {@link Progress} onto the two-pass timeline, so the caller
 * sees a single run of `total` seconds: the analysis pass fills 0–50 %, the
 * correction pass 50–100 %.
 *
 * `eta` is recomputed against the *whole* timeline, which makes it optimistic
 * during the analysis pass — decoding to `-f null` runs faster than the encode
 * that follows, so the estimate tightens once the second pass starts.
 */
export function offsetProgress(progress: Progress, offset: number, total: number): Progress {
  const currentTime = offset + progress.currentTime;
  const shifted: Progress = {
    percent: Math.min(100, (currentTime / total) * 100),
    currentTime,
    totalTime: total,
  };

  if (progress.fps !== undefined) shifted.fps = progress.fps;
  if (progress.speed !== undefined) shifted.speed = progress.speed;
  if (progress.bitrate !== undefined) shifted.bitrate = progress.bitrate;
  if (progress.speed !== undefined && progress.speed > 0) {
    shifted.eta = Math.max(0, (total - currentTime) / progress.speed);
  }

  return shifted;
}
