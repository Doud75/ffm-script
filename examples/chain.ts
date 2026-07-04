import { ffmscript } from '../src/index.js';
import { INPUT, ensureOutDir, out, log } from './_shared.js';

/** Fuse a trim and a resize into a single FFmpeg pass with the fluent builder. */
export default async function run(): Promise<void> {
  await ensureOutDir();

  const output = out('chain.mp4');
  await ffmscript(INPUT).trim({ start: 1, end: 5 }).convert({ width: 640 }).save(output);
  log(`wrote ${output}`);
}
