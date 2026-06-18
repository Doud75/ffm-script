import { extractKeyframeIndex } from '../src/core/mp4.js';
import { SAMPLE } from './helpers.js';

describe('extractKeyframeIndex', () => {
  it('reads keyframe timestamps from the MP4 stss box', async () => {
    const keyframes = await extractKeyframeIndex(SAMPLE);

    // Fixture: 10s @ 30fps, -g 30 → a keyframe every second.
    expect(keyframes.length).toBeGreaterThanOrEqual(9);
    expect(keyframes.length).toBeLessThanOrEqual(11);
    expect(keyframes[0]?.timestamp).toBe(0);

    // Sorted ascending, ~1s apart, all within the clip.
    for (let i = 1; i < keyframes.length; i++) {
      const gap = keyframes[i]!.timestamp - keyframes[i - 1]!.timestamp;
      expect(gap).toBeCloseTo(1, 1);
    }
    expect(keyframes[keyframes.length - 1]!.timestamp).toBeLessThan(10);
  });
});
