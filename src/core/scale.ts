/**
 * Builds an FFmpeg `scale` filter value, or `undefined` when no dimension is
 * requested. A `-2` placeholder lets FFmpeg preserve the aspect ratio while
 * keeping the computed dimension even (required by h264).
 */
export function buildScaleFilter(
  width: number | undefined,
  height: number | undefined,
): string | undefined {
  if (width !== undefined && height !== undefined) return `scale=${width}:${height}`;
  if (width !== undefined) return `scale=${width}:-2`;
  if (height !== undefined) return `scale=-2:${height}`;
  return undefined;
}
