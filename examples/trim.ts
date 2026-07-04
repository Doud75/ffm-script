import { trim } from '../src/index.js';
import { INPUT, ensureOutDir, out, log } from './_shared.js';

/** Cut a frame-accurate 2s–6s segment (precise mode re-encodes to hit the exact timestamps). */
export default async function run(): Promise<void> {
  await ensureOutDir();

  const output = out('trim.mp4');
  await trim(INPUT, output, { start: 2, end: 6, mode: 'precise' });
  log(`wrote ${output}`);
}
