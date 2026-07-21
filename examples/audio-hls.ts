import { audioToHLS, extractAudio } from '../src/index.js';
import { INPUT, ensureOutDir, out, log } from './_shared.js';

/**
 * Package audio into an HLS ladder. Extract the sample's audio to a standalone
 * `.m4a` first (no committed audio fixture), then emit a two-bitrate fMP4/CMAF
 * ladder — `master.m3u8` + one folder per bitrate (`init.mp4` + `.m4s`).
 */
export default async function run(): Promise<void> {
  await ensureOutDir();

  const audio = out('podcast.m4a');
  await extractAudio(INPUT, audio, { codec: 'aac' });

  const dir = out('audio-hls');
  await audioToHLS(audio, dir, {
    bitrates: ['128k', '64k'],
    segmentType: 'fmp4',
    segmentDuration: 6,
  });
  log(`wrote ${dir}/master.m3u8`);
}
