import { overlay } from '../src/index.js';
import { INPUT, ensureWatermark, out, log } from './_shared.js';

/** Burn a translucent watermark into the bottom-right corner of every frame. */
export default async function run(): Promise<void> {
  const watermark = await ensureWatermark();

  const output = out('overlay.mp4');
  await overlay(INPUT, output, {
    watermark,
    position: 'bottom-right',
    opacity: 0.7,
    width: 120,
  });
  log(`wrote ${output}`);
}
