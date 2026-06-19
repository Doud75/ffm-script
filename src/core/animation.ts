/**
 * Builds the leading `fps` (+ optional `scale`) chain shared by both animated
 * outputs. `fps` resamples to the target frame rate; `scale` with a `-1` height
 * preserves the aspect ratio, and `flags=lanczos` keeps downscaled frames crisp.
 */
function frameChain(fps: number, width: number | undefined): string[] {
  const chain = [`fps=${fps}`];
  if (width !== undefined) chain.push(`scale=${width}:-1:flags=lanczos`);
  return chain;
}

/**
 * Builds the `-filter_complex` graph for a high-quality GIF. A GIF is limited to
 * 256 colours, so a per-clip optimal palette is generated and reused in one pass:
 * the resampled stream is split, `palettegen` derives the palette from one branch,
 * and `paletteuse` maps the other branch onto it — far better than the default
 * fixed palette.
 */
export function buildGifFilter(fps: number, width: number | undefined): string {
  const pre = frameChain(fps, width).join(',');
  return `${pre},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
}

/**
 * Builds the `-vf` chain for an animated WebP. WebP is truecolour, so no palette
 * is needed — just the fps/scale resampling.
 */
export function buildWebpFilter(fps: number, width: number | undefined): string {
  return frameChain(fps, width).join(',');
}
