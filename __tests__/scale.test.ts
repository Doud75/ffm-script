import { buildScaleFilter } from '../src/core/scale.js';

describe('buildScaleFilter', () => {
  it('returns undefined when neither dimension is given', () => {
    expect(buildScaleFilter(undefined, undefined)).toBeUndefined();
  });

  it('uses both dimensions verbatim when both are given', () => {
    expect(buildScaleFilter(1280, 720)).toBe('scale=1280:720');
  });

  it('preserves the aspect ratio from width only (even-rounded height)', () => {
    expect(buildScaleFilter(640, undefined)).toBe('scale=640:-2');
  });

  it('preserves the aspect ratio from height only (even-rounded width)', () => {
    expect(buildScaleFilter(undefined, 480)).toBe('scale=-2:480');
  });
});
