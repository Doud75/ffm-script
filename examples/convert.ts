import { convert } from '../src/index.js';
import { INPUT, ensureOutDir, out, log, progressLogger } from './_shared.js';

/** Transcode to a 640px-wide H.264/AAC MP4 with a balanced quality preset. */
export default async function run(): Promise<void> {
  await ensureOutDir();

  const output = out('convert.mp4');
  await convert(INPUT, output, {
    quality: 'balanced',
    width: 640,
    onProgress: progressLogger('convert'),
  });
  log(`wrote ${output}`);
}
