import { parallelConvert } from '../src/index.js';
import { INPUT, ensureOutDir, out, log, progressLogger } from './_shared.js';

/**
 * Keyframe-aware parallel transcode: the timeline is split at keyframes, each
 * chunk is encoded concurrently, then the chunks are joined back together.
 */
export default async function run(): Promise<void> {
  await ensureOutDir();

  const output = out('parallel.mp4');
  await parallelConvert(INPUT, output, {
    quality: 'balanced',
    width: 640,
    onProgress: progressLogger('parallel'),
  });
  log(`wrote ${output}`);
}
