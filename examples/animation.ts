import { toAnimation } from '../src/index.js';
import { INPUT, ensureOutDir, out, log } from './_shared.js';

/** Turn the 1s–4s slice into a looping 320px-wide animated GIF at 12fps. */
export default async function run(): Promise<void> {
  await ensureOutDir();

  const output = out('clip.gif');
  await toAnimation(INPUT, output, { start: 1, end: 4, fps: 12, width: 320 });
  log(`wrote ${output}`);
}
