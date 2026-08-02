import {
  DEFAULT_LOUDNORM_TARGETS,
  buildLoudnormFilter,
  offsetProgress,
  parseLoudnormStats,
  type LoudnormStats,
} from '../src/core/loudnorm.js';
import { InvalidFormatError } from '../src/errors/index.js';
import type { Progress } from '../src/types/index.js';

// Pure module: the filter strings, the stderr parser and the two-pass progress
// remap are all exercised without running FFmpeg.

/** A verbatim loudnorm report, wrapped in the banner FFmpeg prints around it. */
const report = (overrides: Record<string, string> = {}): string => {
  const stats = {
    input_i: '-27.05',
    input_tp: '-11.65',
    input_lra: '6.20',
    input_thresh: '-37.36',
    output_i: '-16.03',
    output_tp: '-1.52',
    output_lra: '5.90',
    output_thresh: '-26.34',
    normalization_type: 'dynamic',
    target_offset: '-0.42',
    ...overrides,
  };
  const body = Object.entries(stats)
    .map(([key, value]) => `\t"${key}" : "${value}"`)
    .join(',\n');
  return `[Parsed_loudnorm_0 @ 0x14e] \n{\n${body}\n}\n`;
};

const banner = 'ffmpeg version 7.1\n  built with clang\nStream #0:0: Audio: aac, 44100 Hz\n';

describe('buildLoudnormFilter', () => {
  it('asks for the JSON report on the analysis pass', () => {
    expect(buildLoudnormFilter(DEFAULT_LOUDNORM_TARGETS)).toBe(
      'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
    );
  });

  it('feeds the measurements back and goes linear on the correction pass', () => {
    const measured: LoudnormStats = {
      inputI: -27.05,
      inputTP: -11.65,
      inputLRA: 6.2,
      inputThresh: -37.36,
      targetOffset: -0.42,
    };

    expect(
      buildLoudnormFilter({ targetLoudness: -23, truePeak: -2, loudnessRange: 7 }, measured),
    ).toBe(
      'loudnorm=I=-23:TP=-2:LRA=7:measured_I=-27.05:measured_TP=-11.65:measured_LRA=6.2:' +
        'measured_thresh=-37.36:offset=-0.42:linear=true',
    );
  });

  it('never asks for the report on the correction pass', () => {
    const measured: LoudnormStats = {
      inputI: -27,
      inputTP: -11,
      inputLRA: 6,
      inputThresh: -37,
      targetOffset: 0,
    };
    expect(buildLoudnormFilter(DEFAULT_LOUDNORM_TARGETS, measured)).not.toContain('print_format');
  });
});

describe('parseLoudnormStats', () => {
  it('extracts the measurements from a real stderr dump', () => {
    expect(parseLoudnormStats(banner + report(), 'in.wav')).toEqual({
      inputI: -27.05,
      inputTP: -11.65,
      inputLRA: 6.2,
      inputThresh: -37.36,
      targetOffset: -0.42,
    });
  });

  it('ignores noise printed after the report', () => {
    const stderr = banner + report() + 'size=N/A time=00:00:10.00 bitrate=N/A speed=42x\n';
    expect(parseLoudnormStats(stderr, 'in.wav')?.inputI).toBe(-27.05);
  });

  it('keeps the last report when several are printed', () => {
    const stderr = report({ input_i: '-30.00' }) + report({ input_i: '-12.00' });
    expect(parseLoudnormStats(stderr, 'in.wav')?.inputI).toBe(-12);
  });

  it('returns null on a silent input, whose measurements are -inf', () => {
    const stderr = report({ input_i: '-inf', target_offset: 'inf' });
    expect(parseLoudnormStats(stderr, 'in.wav')).toBeNull();
  });

  it('throws when stderr carries no JSON block at all', () => {
    expect(() => parseLoudnormStats(banner, 'in.wav')).toThrow(InvalidFormatError);
  });

  it('throws when the JSON block is malformed', () => {
    expect(() => parseLoudnormStats('{ not json }', 'in.wav')).toThrow(InvalidFormatError);
  });

  it('throws when a required key is missing', () => {
    expect(() => parseLoudnormStats('{ "input_i" : "-27.05" }', 'in.wav')).toThrow(/unparseable/);
  });

  it('names the input in the error', () => {
    expect(() => parseLoudnormStats(banner, 'take-1.wav')).toThrow(/take-1\.wav/);
  });
});

describe('offsetProgress', () => {
  const base: Progress = { percent: 50, currentTime: 5, totalTime: 10 };

  it('maps the analysis pass onto the first half of the timeline', () => {
    expect(offsetProgress(base, 0, 20)).toEqual({ percent: 25, currentTime: 5, totalTime: 20 });
  });

  it('maps the correction pass onto the second half', () => {
    expect(offsetProgress(base, 10, 20)).toEqual({ percent: 75, currentTime: 15, totalTime: 20 });
  });

  it('clamps at 100% rather than overshooting', () => {
    const overshoot: Progress = { percent: 100, currentTime: 11, totalTime: 10 };
    expect(offsetProgress(overshoot, 10, 20).percent).toBe(100);
  });

  it('carries fps, speed and bitrate through untouched', () => {
    const rich: Progress = { ...base, fps: 30, speed: 2, bitrate: 128_000 };
    expect(offsetProgress(rich, 10, 20)).toMatchObject({ fps: 30, speed: 2, bitrate: 128_000 });
  });

  it('recomputes eta against the whole two-pass timeline', () => {
    const rich: Progress = { ...base, speed: 2 };
    // 20s total - 15s done = 5s left, at 2x realtime.
    expect(offsetProgress(rich, 10, 20).eta).toBe(2.5);
  });

  it('omits eta when no positive speed is known', () => {
    expect(offsetProgress(base, 0, 20).eta).toBeUndefined();
    expect(offsetProgress({ ...base, speed: 0 }, 0, 20).eta).toBeUndefined();
  });
});
