import { thumbnail } from '../src/index.js';
import { INPUT, ensureOutDir, out, log } from './_shared.js';

/** Grab a single 480px-wide JPEG frame at the 3-second mark. */
export default async function run(): Promise<void> {
  await ensureOutDir();

  const output = out('thumb.jpg');
  await thumbnail(INPUT, output, { timestamp: 3, width: 480 });
  log(`wrote ${output}`);
}
