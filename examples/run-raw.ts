import { run as ffmpeg } from '../src/index.js';
import { INPUT, ensureOutDir, out, log, progressLogger } from './_shared.js';

/**
 * The raw escape hatch: pass your own argument list straight to FFmpeg when no
 * high-level operation fits. Here, a 2s stream-copy remux. `duration` lets the
 * library turn FFmpeg's `time=` output into a progress percentage.
 */
export default async function run(): Promise<void> {
  await ensureOutDir();

  const output = out('remux.mp4');
  await ffmpeg(['-i', INPUT, '-t', '2', '-c', 'copy', '-y', output], {
    duration: 10,
    onProgress: progressLogger('run'),
  });
  log(`wrote ${output}`);
}
