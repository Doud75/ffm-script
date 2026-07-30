import { buildOverlayFilter, type OverlayFilterParams } from './overlay.js';

/**
 * The video filters to fuse into a single pass, each already built by its own
 * module. Every field is optional — a spec with none produces no arguments at all.
 */
export interface FilterGraphSpec {
  /** `scale` filter, as returned by {@link buildScaleFilter}. */
  scale?: string | undefined;
  /** `subtitles` filter, as returned by {@link buildSubtitlesFilter}. */
  subtitles?: string | undefined;
  /** Watermark placement; needs the image as a **second** input (`-i watermark`). */
  overlay?: OverlayFilterParams | undefined;
}

/** Label of the stream the overlay is laid onto once the simple filters ran. */
const BASE_LABEL = '[base]';

/**
 * Builds the FFmpeg arguments that apply every requested filter in **one** pass —
 * one re-encode instead of one per operation.
 *
 * The pipeline order is fixed: **scale → subtitles → overlay**. Scaling first
 * renders the subtitles at the output resolution (crisp text, rather than burnt in
 * then resampled) and leaves fewer pixels for the later stages; the watermark comes
 * last so it sits on top of the burnt-in subtitles.
 *
 * Two shapes come out of it:
 * - **No overlay** — the filters are a plain comma-separated chain on a single
 *   input, emitted as `-vf`. With only a `scale` this is byte-for-byte what the
 *   callers built before this module existed.
 * - **With an overlay** — a second input is involved, so it has to be a
 *   `-filter_complex` with explicit labels, plus the `-map`s that select its
 *   output. `-map 0:a?` keeps the source's audio, the `?` making it optional so a
 *   silent input doesn't fail.
 *
 * @returns The arguments to insert on the output side, or `[]` when there is
 * nothing to filter.
 */
export function buildFilterGraph(spec: FilterGraphSpec): string[] {
  const simple: string[] = [];
  if (spec.scale !== undefined) simple.push(spec.scale);
  if (spec.subtitles !== undefined) simple.push(spec.subtitles);

  if (spec.overlay === undefined) {
    return simple.length > 0 ? ['-vf', simple.join(',')] : [];
  }

  // The overlay reads the simple chain's output when there is one, else the input
  // video straight away — an empty `[0:v]…[base]` stage would be dead weight.
  const stages: string[] = [];
  let base = '[0:v]';
  if (simple.length > 0) {
    stages.push(`[0:v]${simple.join(',')}${BASE_LABEL}`);
    base = BASE_LABEL;
  }
  stages.push(buildOverlayFilter(spec.overlay, base));

  return ['-filter_complex', stages.join(';'), '-map', '[out]', '-map', '0:a?'];
}
