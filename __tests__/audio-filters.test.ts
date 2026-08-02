import {
  AUDIO_ENCODERS,
  assertAudioOutput,
  buildSilenceRemoveFilter,
  isAudioOutput,
  resolveAudioEncoder,
} from '../src/core/audio.js';
import { InvalidFormatError } from '../src/errors/index.js';
import type { SilenceMode } from '../src/types/index.js';

// Pure builder tests: no FFmpeg, no filesystem — assert the exact filter string
// and encoder the operations hand to `spawnFFmpeg`.

const silence = (
  mode: SilenceMode,
  overrides: Partial<Parameters<typeof buildSilenceRemoveFilter>[0]> = {},
) =>
  buildSilenceRemoveFilter({ threshold: -50, minDuration: 1, keepSilence: 0, mode, ...overrides });

describe('buildSilenceRemoveFilter', () => {
  it('trims only the head in start mode', () => {
    expect(silence('start')).toBe(
      'silenceremove=start_periods=1:start_silence=0:start_threshold=-50dB',
    );
  });

  it('reverses around the trim in end mode, since silenceremove only cuts from the head', () => {
    expect(silence('end')).toBe(
      'areverse,silenceremove=start_periods=1:start_silence=0:start_threshold=-50dB,areverse',
    );
  });

  it('chains both edges in both mode', () => {
    const head = 'silenceremove=start_periods=1:start_silence=0:start_threshold=-50dB';
    expect(silence('both')).toBe(`${head},areverse,${head},areverse`);
  });

  it('keeps start_periods in all mode, since stop_periods never touches the head', () => {
    expect(silence('all')).toBe(
      'silenceremove=start_periods=1:start_silence=0:start_threshold=-50dB:' +
        'stop_periods=-1:stop_duration=1:stop_threshold=-50dB',
    );
  });

  it("carries the caller's thresholds into every stage", () => {
    expect(silence('both', { threshold: -35, keepSilence: 0.25 })).toBe(
      'silenceremove=start_periods=1:start_silence=0.25:start_threshold=-35dB,areverse,' +
        'silenceremove=start_periods=1:start_silence=0.25:start_threshold=-35dB,areverse',
    );
  });

  it('applies minDuration only in all mode', () => {
    expect(silence('both', { minDuration: 3 })).not.toContain('3');
    expect(silence('all', { minDuration: 3 })).toContain('stop_duration=3');
  });
});

describe('isAudioOutput / assertAudioOutput', () => {
  it.each(Object.keys(AUDIO_ENCODERS))('accepts %s', (ext) => {
    expect(isAudioOutput(`out${ext}`)).toBe(true);
    expect(() => {
      assertAudioOutput(`out${ext}`);
    }).not.toThrow();
  });

  it('rejects a video container', () => {
    expect(isAudioOutput('out.mp4')).toBe(false);
    expect(() => {
      assertAudioOutput('out.mp4');
    }).toThrow(InvalidFormatError);
  });

  it('names the missing extension in the error', () => {
    expect(() => {
      assertAudioOutput('out');
    }).toThrow(/\(none\)/);
  });
});

describe('resolveAudioEncoder', () => {
  it.each([
    ['out.mp3', 'libmp3lame'],
    ['out.aac', 'aac'],
    ['out.m4a', 'aac'],
    ['out.wav', 'pcm_s16le'],
    ['out.flac', 'flac'],
  ])('infers the encoder for %s', (output, encoder) => {
    expect(resolveAudioEncoder(output)).toBe(encoder);
  });

  it('lets an explicit codec override the audio-only default', () => {
    expect(resolveAudioEncoder('out.m4a', 'libfdk_aac')).toBe('libfdk_aac');
  });

  it("falls back to a video container's default audio codec", () => {
    expect(resolveAudioEncoder('out.mp4')).toBe('aac');
    expect(resolveAudioEncoder('out.webm')).toBe('libopus');
  });

  it('rejects a codec the video container cannot carry', () => {
    expect(() => resolveAudioEncoder('out.webm', 'aac')).toThrow(InvalidFormatError);
  });

  it('accepts a codec the video container allows', () => {
    expect(resolveAudioEncoder('out.mp4', 'libmp3lame')).toBe('libmp3lame');
  });

  it('rejects an extension neither table knows', () => {
    expect(() => resolveAudioEncoder('out.ogg')).toThrow(InvalidFormatError);
    expect(() => resolveAudioEncoder('out')).toThrow(/\(none\)/);
  });
});
