import { burnSubtitles } from '../src/index.js';
import { INPUT, ensureSubtitles, out, log } from './_shared.js';

/**
 * Burn an external `.srt` into the video. The fixture has no embedded subtitle
 * track, so we demonstrate the common external-file case here. To pull an
 * embedded track out to a file instead, use `extractSubtitles(input, 'subs.srt')`
 * on an input that actually carries one.
 */
export default async function run(): Promise<void> {
  const subtitles = await ensureSubtitles();

  const output = out('subtitled.mp4');
  await burnSubtitles(INPUT, output, { subtitles });
  log(`wrote ${output}`);
}
