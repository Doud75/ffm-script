import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractKeyframeIndex } from '../src/core/mp4.js';
import { resolveKeyframes } from '../src/core/keyframes.js';
import { SAMPLE } from './helpers.js';

/** Asserts a ~1s-spaced keyframe index for a 10s/-g 30 transcode of SAMPLE. */
function expectOneSecondKeyframes(keyframes: { timestamp: number }[]): void {
  expect(keyframes.length).toBeGreaterThanOrEqual(9);
  expect(keyframes.length).toBeLessThanOrEqual(12);
  expect(keyframes[0]?.timestamp).toBe(0); // anchored to the start
  for (let i = 1; i < keyframes.length; i++) {
    expect(keyframes[i]!.timestamp).toBeGreaterThan(keyframes[i - 1]!.timestamp);
  }
  expect(keyframes[keyframes.length - 1]!.timestamp).toBeLessThan(10);
}

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
      execFileSync('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-i',
        SAMPLE,
        '-g',
        '1',
        '-c:a',
        'aac',
        allIntra,
      ]);
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

describe('resolveKeyframes (multi-container)', () => {
  let dir: string;
  let mov: string;
  let mkv: string;
  let webm: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-containers-'));
    mov = join(dir, 'sample.mov');
    mkv = join(dir, 'sample.mkv');
    webm = join(dir, 'sample.webm');
    // MOV/MKV: just remux (fast). WebM: re-encode to VP8/Vorbis (fastest libvpx settings).
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', SAMPLE, '-c', 'copy', mov]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', SAMPLE, '-c', 'copy', mkv]);
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      SAMPLE,
      '-c:v',
      'libvpx',
      '-b:v',
      '500k',
      '-deadline',
      'realtime',
      '-cpu-used',
      '8',
      '-g',
      '30',
      '-c:a',
      'libvorbis',
      webm,
    ]);
  }, 60_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses MOV through the ISOBMFF stss path (same boxes as MP4)', async () => {
    expectOneSecondKeyframes(await resolveKeyframes(mov));
  });

  it('re-indexes MKV via ffprobe and anchors the first keyframe to 0', async () => {
    expectOneSecondKeyframes(await resolveKeyframes(mkv));
  });

  it('re-indexes WebM via ffprobe', async () => {
    expectOneSecondKeyframes(await resolveKeyframes(webm));
  });
});
