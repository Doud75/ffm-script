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

/** Everything a {@link SegmentExecutor} needs to encode one segment. */
export interface SegmentExecutorContext {
  /** Source video to encode this segment from (the input passed to `parallelConvert`). */
  input: string;
  /**
   * Shared FFmpeg video-encode flags for the chunk, *without* input, seek or
   * output — e.g. `['-an', '-c:v', 'libx264', '-b:v', '2000k', '-vf', 'scale=1280:-2']`.
   * Every segment gets the **same** flags, so all chunks share one encoding and the
   * joins can be stream-copied. A worker wraps them into a full command:
   * `ffmpeg -ss <segment.startTime> -i <input> [-t <duration>] <encodeArgs> -y <chunk>`
   * — add `-t` only when `segment.endTime` is defined (the last segment runs to EOF).
   */
  encodeArgs: string[];
  /** Segment length in seconds (`endTime - startTime`, or input end − `startTime` for the last). */
  duration: number;
  /**
   * Report the seconds of this segment processed so far, feeding the aggregated
   * `onProgress` of `parallelConvert`. Optional to call.
   */
  onProgress?: (secondsProcessed: number) => void;
  /** Abort signal to honour; stop the encode when it fires. */
  signal?: AbortSignal;
}

/**
 * Encodes one segment and resolves with the path to the produced chunk. The chunk
 * must be h264 with the same parameters as every other chunk (see
 * {@link SegmentExecutorContext.encodeArgs}) so `parallelConvert` can join them
 * with a stream copy, and the returned path must be readable by the machine
 * running `parallelConvert` when the join happens.
 *
 * `parallelConvert` uses a local FFmpeg executor by default. Supply your own to
 * run the per-segment encodes wherever you like — dispatch each segment to a
 * remote worker over your transport, then return the retrieved chunk path. That
 * is how the chunked model scales past a single machine.
 */
export type SegmentExecutor = (
  segment: Segment,
  context: SegmentExecutorContext,
) => Promise<string>;

/**
 * Splits the timeline into roughly balanced contiguous segments whose
 * boundaries fall exactly on keyframes, so each chunk can be decoded
 * independently and re-joined without artefacts.
 *
 * Produces at most `segmentCount` segments (capped by the keyframe count).
 */
export function planSegments(keyframes: Keyframe[], options: { segmentCount: number }): Segment[] {
  if (keyframes.length === 0) return [];

  const requested = Math.max(1, Math.floor(options.segmentCount));
  const segmentCount = Math.min(requested, keyframes.length);

  // Pick evenly-spaced keyframe indices as segment starts (deduped).
  const startIndices = [
    ...new Set(
      Array.from({ length: segmentCount }, (_, i) =>
        Math.floor((i * keyframes.length) / segmentCount),
      ),
    ),
  ];

  return startIndices.map((startIdx, i) => {
    const startTime = keyframes[startIdx]!.timestamp;
    const nextIdx = startIndices[i + 1];
    const endTime = nextIdx !== undefined ? keyframes[nextIdx]!.timestamp : undefined;
    return { index: i, startTime, ...(endTime !== undefined ? { endTime } : {}) };
  });
}
