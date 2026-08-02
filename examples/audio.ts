import { normalizeAudio, resampleAudio, trimSilence, probe, run } from '../src/index.js';
import { INPUT, ensureOutDir, out, log, progressLogger } from './_shared.js';

/**
 * Build a source with actual silence to trim: 2s quiet, 3s of a 440Hz tone, 2s
 * quiet. The committed sample is a continuous tone, so `silenceremove` would
 * have nothing to bite on — generated with `run()` rather than committed.
 */
async function ensureSilencePadded(): Promise<string> {
  const path = out('padded.wav');
  await run([
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100:cl=mono:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:r=44100:d=3',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100:cl=mono:d=2',
    '-filter_complex',
    '[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]',
    '-map',
    '[out]',
    '-y',
    path,
  ]);
  return path;
}

/** The v1.5 audio toolkit: loudness normalisation, resampling, silence trimming. */
export default async function runExample(): Promise<void> {
  await ensureOutDir();

  // 1. Normalise the soundtrack of a video. The picture is copied verbatim
  //    (`-c:v copy`), so this costs no generation loss on the video side.
  //    Two FFmpeg passes: progress spans both as one 0–100% timeline.
  const normalized = out('normalized.mp4');
  await normalizeAudio(INPUT, normalized, { onProgress: progressLogger('normalize') });
  const normInfo = await probe(normalized);
  log(`wrote ${normalized} (video still ${normInfo.video?.codec}, audio ${normInfo.audio?.codec})`);

  // 2. Same filter, audio-only output and a broadcast target instead of the
  //    streaming default. The video stream is simply dropped.
  const podcast = out('normalized-ebu.mp3');
  await normalizeAudio(INPUT, podcast, {
    targetLoudness: -23,
    truePeak: -2,
    loudnessRange: 7,
    audioBitrate: '192k',
  });
  log(`wrote ${podcast} (EBU R128 -23 LUFS)`);

  // 3. Downmix to what a speech-to-text pipeline usually wants: 16kHz mono WAV.
  const speech = out('speech-16k-mono.wav');
  await resampleAudio(INPUT, speech, { sampleRate: 16000, channels: 1 });
  const speechInfo = await probe(speech);
  log(`wrote ${speech} (${speechInfo.audio?.sampleRate}Hz, ${speechInfo.audio?.channels}ch)`);

  // 4. Strip the dead air. `both` (the default) cuts each end; `all` also
  //    collapses the interior gaps down to `minDuration`.
  const padded = await ensureSilencePadded();
  const paddedInfo = await probe(padded);

  const tight = out('trimmed.wav');
  await trimSilence(padded, tight, { keepSilence: 0.2 });
  const tightInfo = await probe(tight);
  log(
    `trimmed ${paddedInfo.duration.toFixed(2)}s → ${tightInfo.duration.toFixed(2)}s ` +
      `(2s + 2s of silence removed, 0.2s of lead-in kept)`,
  );
}
