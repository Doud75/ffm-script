import { concat } from '../src/index.js';
import { INPUT, ensureOutDir, out, log } from './_shared.js';

/**
 * Join clips end to end. We concat the fixture with itself: identical codecs and
 * parameters, so `auto` picks the fast stream-copy path (no re-encode).
 */
export default async function run(): Promise<void> {
  await ensureOutDir();

  const output = out('concat.mp4');
  await concat([INPUT, INPUT], output, { mode: 'fast' });
  log(`wrote ${output}`);
}
