import { toHLS } from '../src/index.js';
import { INPUT, ensureOutDir, out, log } from './_shared.js';

/** Package into an HLS adaptive-bitrate ladder (two variants, 2s segments). */
export default async function run(): Promise<void> {
  await ensureOutDir();

  const dir = out('hls');
  await toHLS(INPUT, dir, {
    resolutions: [
      { width: 640, bitrate: '800k' },
      { width: 320, bitrate: '400k' },
    ],
    segmentDuration: 2,
  });
  log(`wrote ${dir}/master.m3u8`);
}
