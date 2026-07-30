import { ffmscript, probe } from '../src/index.js';
import {
  INPUT,
  ensureOutDir,
  ensureWatermark,
  ensureSubtitles,
  out,
  log,
  progressLogger,
} from './_shared.js';

/**
 * Compose several video operations into a **single** FFmpeg pass with the
 * chainable API: cut a clip, resize it, burn subtitles into the picture and stamp
 * a watermark on top — one re-encode instead of four.
 *
 * Run each of those separately (`trim`, `convert`, `burnSubtitles`, `overlay`) and
 * the video is decoded and re-encoded four times, losing a generation each round.
 * Here the filters are fused into one graph, applied in a fixed order:
 * scale → subtitles → overlay.
 */
export default async function run(): Promise<void> {
  await ensureOutDir();
  const watermark = await ensureWatermark();
  const subtitles = await ensureSubtitles();

  const output = out('filters.mp4');
  await ffmscript(INPUT)
    // The trim defines the segment; the filters below apply to it. Subtitle cues
    // are read on the trimmed timeline, since the input seek restarts timestamps.
    .trim({ start: 0, end: 6 })
    .convert({ width: 640, quality: 'balanced' })
    .burnSubtitles({ subtitles })
    .overlay({ watermark, position: 'top-right', opacity: 0.7, width: 120 })
    .save(output, { onProgress: progressLogger('filters') });

  const info = await probe(output);
  log(`wrote ${output}`);
  log(`→ ${info.video?.width}x${info.video?.height}, ${info.duration.toFixed(1)}s, 1 pass`);
}
