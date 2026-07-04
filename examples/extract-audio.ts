import { extractAudio } from '../src/index.js';
import { INPUT, ensureOutDir, out, log } from './_shared.js';

/** Pull the audio track out to a standalone 192kbps MP3 (codec inferred from the extension). */
export default async function run(): Promise<void> {
  await ensureOutDir();

  const output = out('audio.mp3');
  await extractAudio(INPUT, output, { bitrate: '192k' });
  log(`wrote ${output}`);
}
