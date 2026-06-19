import type { OverlayPosition } from '../types/index.js';

/**
 * Maps an anchor to the `overlay` filter's `x:y` expression. `W`/`H` are the main
 * video's dimensions and `w`/`h` the overlay's — FFmpeg substitutes them at
 * filter time, so the placement is correct whatever the watermark's size. The
 * `margin` insets the watermark from the frame edges (ignored when centred).
 */
const POSITION_EXPR: Record<OverlayPosition, (margin: number) => string> = {
  'top-left': (m) => `${m}:${m}`,
  'top-right': (m) => `W-w-${m}:${m}`,
  'bottom-left': (m) => `${m}:H-h-${m}`,
  'bottom-right': (m) => `W-w-${m}:H-h-${m}`,
  center: () => `(W-w)/2:(H-h)/2`,
};

/** Inputs to {@link buildOverlayFilter}. */
export interface OverlayFilterParams {
  /** Where the watermark is anchored within the frame. */
  position: OverlayPosition;
  /** Gap in pixels from the frame edges (ignored for `'center'`). */
  margin: number;
  /** Watermark opacity in [0, 1]. */
  opacity: number;
  /** Scale the watermark to this width in pixels (height preserves aspect ratio). */
  width: number | undefined;
}

/**
 * Builds the `-filter_complex` graph that scales/fades the watermark (input `1`)
 * and overlays it onto the video (input `0`), exposing the result as `[out]`.
 *
 * Transformations are only inserted when they change something: full opacity and
 * native size overlay `[1:v]` directly. Opacity uses `format=rgba` +
 * `colorchannelmixer=aa` so a watermark without an alpha channel (e.g. a JPEG)
 * still fades. The output is always labelled `[out]` so callers can map it
 * uniformly.
 */
export function buildOverlayFilter(params: OverlayFilterParams): string {
  const { position, margin, opacity, width } = params;

  const wmFilters: string[] = [];
  if (opacity < 1) wmFilters.push(`format=rgba,colorchannelmixer=aa=${opacity}`);
  if (width !== undefined) wmFilters.push(`scale=${width}:-1`);

  const overlayExpr = POSITION_EXPR[position](margin);

  if (wmFilters.length === 0) {
    return `[0:v][1:v]overlay=${overlayExpr}[out]`;
  }
  return `[1:v]${wmFilters.join(',')}[wm];[0:v][wm]overlay=${overlayExpr}[out]`;
}
