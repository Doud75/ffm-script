import { checkDependencies, probe } from '../src/index.js';
import { INPUT, log } from './_shared.js';

/** Inspect a media file: duration, size, bitrate and every stream it carries. */
export default async function run(): Promise<void> {
  await checkDependencies();

  const info = await probe(INPUT);
  log(`duration: ${info.duration}s`);
  log(`size: ${info.size} bytes`);
  log(`bitrate: ${info.bitrate} bps`);
  log(`streams: ${info.streams.length}`);
  for (const stream of info.streams) {
    log(`  #${stream.index} ${stream.type} (${stream.codec})`);
  }
  if (info.video) {
    log(`video: ${info.video.width}x${info.video.height} @ ${info.video.fps}fps`);
  }
  if (info.audio) {
    log(`audio: ${info.audio.channels}ch @ ${info.audio.sampleRate}Hz`);
  }
}
