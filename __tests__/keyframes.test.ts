import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  describe('all-intra fallback (no stss box)', () => {
    let dir: string;
    let allIntra: string;

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'ffm-allintra-'));
      allIntra = join(dir, 'allintra.mp4');
      // -g 1 makes every frame a keyframe; the muxer then omits the stss box.
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', SAMPLE, '-g', '1', '-c:a', 'aac', allIntra]);
    });

    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('treats every frame as a keyframe', async () => {
      const keyframes = await extractKeyframeIndex(allIntra);

      // 10s @ 30fps with every frame a keyframe → ~300 entries.
      expect(keyframes.length).toBeGreaterThanOrEqual(290);
      expect(keyframes.length).toBeLessThanOrEqual(310);
      expect(keyframes[0]?.timestamp).toBe(0);

      // Strictly increasing, ~1/30s apart, all within the clip.
      for (let i = 1; i < keyframes.length; i++) {
        const gap = keyframes[i]!.timestamp - keyframes[i - 1]!.timestamp;
        expect(gap).toBeCloseTo(1 / 30, 2);
      }
      expect(keyframes[keyframes.length - 1]!.timestamp).toBeLessThan(10);
    });
  });
});
