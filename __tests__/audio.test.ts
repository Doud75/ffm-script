import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeAudio, resampleAudio, trimSilence } from '../src/operations/audio.js';
import { parseLoudnormStats } from '../src/core/loudnorm.js';
import { FileNotFoundError, InvalidFormatError, InvalidOptionsError } from '../src/errors/index.js';
import type { Progress } from '../src/types/index.js';
import { SAMPLE, makeSilencePaddedWav, makeSilentWav, makeVideoWithoutAudio } from './helpers.js';

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  sample_rate?: string;
  channels?: number;
}

function ffprobeStreams(file: string): ProbeStream[] {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', file],
    { encoding: 'utf8' },
  );
  return (JSON.parse(out) as { streams?: ProbeStream[] }).streams ?? [];
}

function duration(file: string): number {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  );
  return Number(out.trim());
}

/** Re-runs loudnorm's analysis pass on a file and returns its integrated loudness. */
function loudness(file: string): number {
  const { stderr } = spawnSync(
    'ffmpeg',
    ['-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  return parseLoudnormStats(stderr, file)?.inputI ?? NaN;
}

let dir: string;
let padded: string;
let silent: string;
let mute: string;
const out = (name: string): string => join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ffm-audio-'));
  padded = makeSilencePaddedWav(dir);
  silent = makeSilentWav(dir);
  mute = makeVideoWithoutAudio(dir);
}, 60_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('normalizeAudio', () => {
  it('hits the default -16 LUFS target and copies the video stream through', async () => {
    const output = out('norm.mp4');
    await normalizeAudio(SAMPLE, output);

    // -c:v copy, so the picture must survive as the very same codec.
    const streams = ffprobeStreams(output);
    expect(streams.find((s) => s.codec_type === 'video')?.codec_name).toBe('h264');
    expect(loudness(output)).toBeCloseTo(-16, 0);
  }, 60_000);

  it('honours explicit EBU R128 targets', async () => {
    const output = out('norm-23.mp3');
    await normalizeAudio(SAMPLE, output, { targetLoudness: -23, truePeak: -2, loudnessRange: 7 });

    expect(loudness(output)).toBeCloseTo(-23, 0);
  }, 60_000);

  it('drops the video when the output is audio-only', async () => {
    const streams = ffprobeStreams(out('norm-23.mp3'));
    expect(streams.some((s) => s.codec_type === 'video')).toBe(false);
    expect(streams[0]?.codec_name).toBe('mp3');
  });

  it('reports progress across both passes as one 0–100% timeline', async () => {
    const percents: number[] = [];
    await normalizeAudio(SAMPLE, out('norm-progress.m4a'), {
      onProgress: (p: Progress) => percents.push(p.percent),
    });

    // The analysis pass fills the first half, the correction pass the second.
    // On a 10s input each pass may only emit its closing status line, so the
    // check is that both contributed and that the timeline never goes backwards.
    expect(percents.length).toBeGreaterThan(1);
    expect(percents.some((p) => p <= 50)).toBe(true);
    expect(percents.some((p) => p > 50)).toBe(true);
    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
  }, 60_000);

  it('falls back to dynamic mode on a silent input measuring -inf', async () => {
    const output = out('norm-silent.wav');
    await expect(normalizeAudio(silent, output)).resolves.toBeUndefined();
    expect(duration(output)).toBeCloseTo(2, 1);
  }, 60_000);

  it('applies the requested sample rate and bitrate, and threads a live signal', async () => {
    const output = out('norm-22k.m4a');
    // A signal that never fires still has to travel through both passes.
    await normalizeAudio(SAMPLE, output, {
      sampleRate: 22050,
      audioBitrate: '96k',
      signal: new AbortController().signal,
    });

    expect(ffprobeStreams(output)[0]?.sample_rate).toBe('22050');
  }, 60_000);

  it('writes an audio-only source into a video container', async () => {
    const output = out('norm-audio-in.mp4');
    await normalizeAudio(padded, output);

    const streams = ffprobeStreams(output);
    expect(streams.some((s) => s.codec_type === 'video')).toBe(false);
    expect(streams[0]?.codec_name).toBe('aac');
  }, 60_000);

  it('rejects a loudness target outside the accepted range', async () => {
    await expect(
      normalizeAudio(SAMPLE, out('bad.mp3'), { targetLoudness: -100 }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
    await expect(normalizeAudio(SAMPLE, out('bad.mp3'), { truePeak: 3 })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
    await expect(
      normalizeAudio(SAMPLE, out('bad.mp3'), { loudnessRange: 0 }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('rejects a non-integer sample rate', async () => {
    await expect(normalizeAudio(SAMPLE, out('bad.mp3'), { sampleRate: 44100.5 })).rejects.toThrow(
      /integer/,
    );
  });

  it('rejects copying h264 into a container that cannot carry it', async () => {
    await expect(normalizeAudio(SAMPLE, out('norm.webm'))).rejects.toBeInstanceOf(
      InvalidFormatError,
    );
  }, 30_000);

  it('rejects an input with no audio stream', async () => {
    await expect(normalizeAudio(mute, out('n.mp3'))).rejects.toThrow(/no audio stream/);
  }, 30_000);

  it('throws FileNotFoundError when the input is missing', async () => {
    await expect(normalizeAudio(out('nope.mp4'), out('n.mp3'))).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
  });
});

describe('resampleAudio', () => {
  it('applies the sample rate and channel count', async () => {
    const output = out('res.wav');
    await resampleAudio(SAMPLE, output, { sampleRate: 22050, channels: 1 });

    const audio = ffprobeStreams(output)[0];
    expect(audio?.codec_name).toBe('pcm_s16le');
    expect(audio?.sample_rate).toBe('22050');
    expect(audio?.channels).toBe(1);
  }, 60_000);

  it('copies the video through when the output is a video container', async () => {
    const output = out('res.mp4');
    await resampleAudio(SAMPLE, output, { sampleRate: 48000, audioBitrate: '128k' });

    const streams = ffprobeStreams(output);
    expect(streams.find((s) => s.codec_type === 'video')?.codec_name).toBe('h264');
    expect(streams.find((s) => s.codec_type === 'audio')?.sample_rate).toBe('48000');
  }, 60_000);

  it('rejects a call that changes nothing', async () => {
    await expect(resampleAudio(SAMPLE, out('res-bad.wav'))).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('rejects an input with no audio stream', async () => {
    await expect(resampleAudio(mute, out('r.wav'), { channels: 1 })).rejects.toThrow(
      /no audio stream/,
    );
  }, 30_000);

  it('rejects out-of-range values', async () => {
    await expect(
      resampleAudio(SAMPLE, out('res-bad.wav'), { sampleRate: 1000 }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
    await expect(
      resampleAudio(SAMPLE, out('res-bad.wav'), { channels: 99 }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });
});

describe('trimSilence', () => {
  // The source is 2s silence + 3s tone + 2s silence.
  it('strips both edges by default', async () => {
    const output = out('trim-both.wav');
    await trimSilence(padded, output);
    expect(duration(output)).toBeCloseTo(3, 1);
  }, 30_000);

  it('strips only the head in start mode', async () => {
    const output = out('trim-start.wav');
    await trimSilence(padded, output, { mode: 'start' });
    expect(duration(output)).toBeCloseTo(5, 1);
  }, 30_000);

  it('strips only the tail in end mode', async () => {
    const output = out('trim-end.wav');
    await trimSilence(padded, output, { mode: 'end' });
    expect(duration(output)).toBeCloseTo(5, 1);
  }, 30_000);

  it('shortens interior silence to minDuration in all mode', async () => {
    const output = out('trim-all.wav');
    await trimSilence(padded, output, { mode: 'all', minDuration: 1 });
    // Head gone, tone kept, trailing silence collapsed to 1s.
    expect(duration(output)).toBeCloseTo(4, 1);
  }, 30_000);

  it('leaves keepSilence seconds of lead-in', async () => {
    const output = out('trim-keep.wav');
    await trimSilence(padded, output, { mode: 'start', keepSilence: 0.5 });
    expect(duration(output)).toBeCloseTo(5.5, 1);
  }, 30_000);

  it('honours the output encoder', async () => {
    const output = out('trim.flac');
    await trimSilence(padded, output, { audioBitrate: '128k' });
    expect(ffprobeStreams(output)[0]?.codec_name).toBe('flac');
  }, 30_000);

  it('rejects a video input, which cutting the audio would desynchronise', async () => {
    await expect(trimSilence(SAMPLE, out('t.wav'))).rejects.toBeInstanceOf(InvalidFormatError);
  });

  it('rejects a video output', async () => {
    await expect(trimSilence(padded, out('t.mp4'))).rejects.toBeInstanceOf(InvalidFormatError);
  });

  it('rejects an unknown mode reaching it from untyped code', async () => {
    await expect(
      trimSilence(padded, out('t.wav'), { mode: 'middle' as never }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('rejects a positive threshold and out-of-range durations', async () => {
    await expect(trimSilence(padded, out('t.wav'), { threshold: 5 })).rejects.toThrow(/negative/);
    await expect(trimSilence(padded, out('t.wav'), { minDuration: -1 })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
    await expect(trimSilence(padded, out('t.wav'), { keepSilence: -1 })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });
});
