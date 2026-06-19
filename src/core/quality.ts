import { InvalidOptionsError } from '../errors/index.js';
import type { Quality } from '../types/index.js';

/**
 * Semantic quality presets, mapped to libx264's two main knobs:
 * - `-crf` (Constant Rate Factor) is the quality/size dial — lower means higher
 *   quality and a bigger file.
 * - `-preset` is the speed/compression-efficiency dial — slower squeezes more
 *   quality into the same size, at the cost of encode time.
 */
const PRESETS: Record<Quality, { crf: number; preset: string }> = {
  high: { crf: 18, preset: 'slow' },
  balanced: { crf: 23, preset: 'medium' },
  small: { crf: 28, preset: 'medium' },
};

/** FFmpeg arguments (`-crf` / `-preset`) for a semantic quality preset. */
export function qualityArgs(quality: Quality): string[] {
  const { crf, preset } = PRESETS[quality];
  return ['-crf', String(crf), '-preset', preset];
}

/**
 * Rejects combining a `quality` preset with an explicit video bitrate. CRF
 * (constant quality) and `-b:v` (target a size) are opposite encoding modes;
 * passing both is contradictory, so callers must pick one.
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
        'quality uses constant-quality CRF, a bitrate targets a size — set only one',
    );
  }
}
