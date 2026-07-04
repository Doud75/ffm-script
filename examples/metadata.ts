import { setMetadata, probe } from '../src/index.js';
import { INPUT, ensureOutDir, out, log } from './_shared.js';

/** Write container tags (title/artist) and read them back to confirm. */
export default async function run(): Promise<void> {
  await ensureOutDir();

  const output = out('tagged.mp4');
  await setMetadata(INPUT, output, {
    tags: { title: 'Demo', artist: 'ffm-script' },
  });

  const info = await probe(output);
  log(`wrote ${output}`);
  log(`title: ${info.tags.title ?? '(none)'}`);
  log(`artist: ${info.tags.artist ?? '(none)'}`);
}
