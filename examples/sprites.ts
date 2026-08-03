import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toSprites } from '../src/index.js';
import { INPUT, ensureOutDir, out, log } from './_shared.js';

/**
 * Build a scrubbing storyboard: sprite sheets + the WebVTT a player reads to
 * preview a frame under the cursor. The sample is only 10s, so sample every
 * second (the default 10s interval would yield a single thumbnail) and use a
 * small 3x3 grid to show the spill onto a second sheet.
 */
export default async function run(): Promise<void> {
  await ensureOutDir();

  const dir = out('sprites');
  await toSprites(INPUT, dir, { interval: 1, width: 160, columns: 3, rows: 3 });

  const sheets = (await readdir(dir)).filter((f) => f.endsWith('.jpg')).sort();
  log(`wrote ${sheets.length} sheet(s): ${sheets.join(', ')}`);

  const vtt = await readFile(join(dir, 'storyboard.vtt'), 'utf8');
  log(`storyboard.vtt — ${(vtt.match(/ --> /g) ?? []).length} cues, first two:`);
  for (const line of vtt.split('\n').slice(0, 7)) log(`  ${line}`);
}
