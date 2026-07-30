import { InvalidOptionsError } from '../errors/index.js';
import type { OverlayOptions, OverlayPosition } from '../types/index.js';

const DEFAULT_POSITION = 'bottom-right' as const;
const DEFAULT_MARGIN = 10;
const DEFAULT_OPACITY = 1;

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
 * Applies the defaults and validates the ranges of the watermark options, turning
 * them into {@link OverlayFilterParams}. Shared by {@link overlay} and the
 * chainable API, so both reject the same values with the same messages.
 *
 * @throws {InvalidOptionsError} when `opacity`, `margin` or `width` are out of range.
 */
export function resolveOverlayParams(options: OverlayOptions): OverlayFilterParams {
  const opacity = options.opacity ?? DEFAULT_OPACITY;
  if (opacity < 0 || opacity > 1) {
    throw new InvalidOptionsError(`opacity must be between 0 and 1 (got ${opacity})`);
  }
  const margin = options.margin ?? DEFAULT_MARGIN;
  if (!Number.isInteger(margin) || margin < 0) {
    throw new InvalidOptionsError(`margin must be a non-negative integer (got ${margin})`);
  }
  if (options.width !== undefined && (!Number.isInteger(options.width) || options.width <= 0)) {
    throw new InvalidOptionsError(`width must be a positive integer (got ${options.width})`);
  }

  return {
    position: options.position ?? DEFAULT_POSITION,
    margin,
    opacity,
    width: options.width,
  };
}

/**
 * Builds the `-filter_complex` graph that scales/fades the watermark (input `1`)
 * and overlays it onto the video, exposing the result as `[out]`.
 *
 * Transformations are only inserted when they change something: full opacity and
 * native size overlay `[1:v]` directly. Opacity uses `format=rgba` +
 * `colorchannelmixer=aa` so a watermark without an alpha channel (e.g. a JPEG)
 * still fades. The output is always labelled `[out]` so callers can map it
 * uniformly.
 *
 * @param params - Placement, margin, opacity and width of the watermark.
 * @param base - Label of the stream the watermark is laid onto. Defaults to the
 * first input's video (`'[0:v]'`); a composed graph passes the label of its own
 * last stage instead, which is what lets the overlay stack on top of other filters.
 */
export function buildOverlayFilter(params: OverlayFilterParams, base = '[0:v]'): string {
  const { position, margin, opacity, width } = params;

  const wmFilters: string[] = [];
  if (opacity < 1) wmFilters.push(`format=rgba,colorchannelmixer=aa=${opacity}`);
  if (width !== undefined) wmFilters.push(`scale=${width}:-1`);

  const overlayExpr = POSITION_EXPR[position](margin);

  if (wmFilters.length === 0) {
    return `${base}[1:v]overlay=${overlayExpr}[out]`;
  }
  return `[1:v]${wmFilters.join(',')}[wm];${base}[wm]overlay=${overlayExpr}[out]`;
}
