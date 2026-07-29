import { listHwaccels, convert, probe } from '../src/index.js';
import { INPUT, ensureOutDir, out, log, progressLogger } from './_shared.js';

/**
 * Hardware-accelerated transcoding, with a software fallback.
 *
 * Two independent halves of the pipeline can move to the GPU:
 * - `hwaccel` decodes the input there (FFmpeg `-hwaccel`);
 * - a hardware `videoCodec` encodes the output there.
 *
 * Neither is guaranteed to exist, so this picks what the host actually offers
 * and degrades to plain libx264 when it offers nothing.
 */

/** Hardware encoders worth trying, by the decode method that pairs with them. */
const ENCODERS: Record<string, string> = {
  videotoolbox: 'h264_videotoolbox', // macOS
  cuda: 'h264_nvenc', // NVIDIA
  qsv: 'h264_qsv', // Intel Quick Sync
  vaapi: 'h264_vaapi', // Linux VA-API
};

export default async function run(): Promise<void> {
  await ensureOutDir();

  // Being listed means FFmpeg was *compiled* with the method — not that this
  // machine can run it. Keep a software fallback either way.
  const available = await listHwaccels();
  log(`ffmpeg reports: ${available.length > 0 ? available.join(', ') : '(none)'}`);

  const hwaccel = Object.keys(ENCODERS).find((name) => available.includes(name));
  const videoCodec = hwaccel !== undefined ? ENCODERS[hwaccel] : undefined;

  if (hwaccel === undefined) {
    log('no hardware acceleration available — falling back to software libx264');
  } else {
    log(`using ${hwaccel} to decode and ${String(videoCodec)} to encode`);
  }

  const output = out('hwaccel.mp4');
  await convert(INPUT, output, {
    // Spread so the options stay absent (not `undefined`) on a software host.
    ...(hwaccel !== undefined && { hwaccel }),
    ...(videoCodec !== undefined && { videoCodec }),
    // The same semantic preset works everywhere: it is translated into whatever
    // constant-quality flag the chosen encoder actually understands (-crf for
    // libx264, -cq for nvenc, -q:v for videotoolbox…).
    quality: 'balanced',
    width: 640,
    onProgress: progressLogger('hwaccel'),
  });

  const info = await probe(output);
  log(`wrote ${output} — ${String(info.video?.codec)} ${String(info.video?.width)}px`);
}
