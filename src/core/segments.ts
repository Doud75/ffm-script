import type { Keyframe } from '../types/index.js';

/** A contiguous segment to transcode, bounded by keyframes. */
export interface Segment {
  /** Position in the output order (0-based). */
  index: number;
  /** Start time in seconds (always on a keyframe). */
  startTime: number;
  /** End time in seconds (on a keyframe), or omitted for the final segment (to EOF). */
  endTime?: number;
}

/**
 * Splits the timeline into roughly balanced contiguous segments whose
 * boundaries fall exactly on keyframes, so each chunk can be decoded
 * independently and re-joined without artefacts.
 *
 * Produces at most `workerCount` segments (capped by the keyframe count).
 */
export function planSegments(
  keyframes: Keyframe[],
  options: { workerCount: number },
): Segment[] {
  if (keyframes.length === 0) return [];

  const workerCount = Math.max(1, Math.floor(options.workerCount));
  const segmentCount = Math.min(workerCount, keyframes.length);

  // Pick evenly-spaced keyframe indices as segment starts (deduped).
  const startIndices = [
    ...new Set(
      Array.from({ length: segmentCount }, (_, i) => Math.floor((i * keyframes.length) / segmentCount)),
    ),
  ];

  return startIndices.map((startIdx, i) => {
    const startTime = keyframes[startIdx]!.timestamp;
    const nextIdx = startIndices[i + 1];
    const endTime = nextIdx !== undefined ? keyframes[nextIdx]!.timestamp : undefined;
    return { index: i, startTime, ...(endTime !== undefined ? { endTime } : {}) };
  });
}
