import { convert } from '../src/index.js';
import type { Progress } from '../src/index.js';
import { INPUT, ensureOutDir, out, log } from './_shared.js';

/**
 * The enriched progress callback: beyond `percent`, FFmpeg's status line yields
 * `fps`, `speed` (× realtime), `bitrate` (bits/s) and a derived `eta` (seconds
 * left). We re-encode (not stream-copy) so FFmpeg actually reports encode stats.
 */
export default async function run(): Promise<void> {
  await ensureOutDir();

  const output = out('progress.mp4');
  let last = -1;
  await convert(INPUT, output, {
    quality: 'small',
    width: 640,
    onProgress: (p: Progress) => {
      const pct = Math.floor(p.percent);
      if (pct < last + 25) return; // throttle: log roughly every 25%
      last = pct;
      const parts = [`${pct}%`];
      if (p.fps !== undefined) parts.push(`${p.fps}fps`);
      if (p.speed !== undefined) parts.push(`${p.speed}x`);
      if (p.bitrate !== undefined) parts.push(`${Math.round(p.bitrate / 1000)}kbps`);
      if (p.eta !== undefined) parts.push(`eta ${p.eta.toFixed(1)}s`);
      log(parts.join('  '));
    },
  });
  log(`wrote ${output}`);
}
