import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { overlay } from '../src/operations/overlay.js';
import { buildOverlayFilter } from '../src/core/overlay.js';
import { probe } from '../src/operations/probe.js';
import { FileNotFoundError, InvalidFormatError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

describe('buildOverlayFilter', () => {
  it('overlays the watermark directly when opaque and unscaled', () => {
    expect(buildOverlayFilter({ position: 'bottom-right', margin: 10, opacity: 1, width: undefined })).toBe(
      '[0:v][1:v]overlay=W-w-10:H-h-10[out]',
    );
  });

  it('maps each anchor to the right x:y expression', () => {
    const at = (position: Parameters<typeof buildOverlayFilter>[0]['position']) =>
      buildOverlayFilter({ position, margin: 5, opacity: 1, width: undefined });
    expect(at('top-left')).toContain('overlay=5:5[out]');
    expect(at('top-right')).toContain('overlay=W-w-5:5[out]');
    expect(at('bottom-left')).toContain('overlay=5:H-h-5[out]');
    expect(at('bottom-right')).toContain('overlay=W-w-5:H-h-5[out]');
    expect(at('center')).toContain('overlay=(W-w)/2:(H-h)/2[out]'); // margin ignored
  });

  it('fades the watermark via an rgba colorchannelmixer when opacity < 1', () => {
    expect(buildOverlayFilter({ position: 'center', margin: 0, opacity: 0.5, width: undefined })).toBe(
      '[1:v]format=rgba,colorchannelmixer=aa=0.5[wm];[0:v][wm]overlay=(W-w)/2:(H-h)/2[out]',
    );
  });

  it('scales the watermark to the requested width', () => {
    expect(buildOverlayFilter({ position: 'top-left', margin: 0, opacity: 1, width: 200 })).toBe(
      '[1:v]scale=200:-1[wm];[0:v][wm]overlay=0:0[out]',
    );
  });

  it('combines opacity and scale, in that order', () => {
    expect(buildOverlayFilter({ position: 'top-left', margin: 0, opacity: 0.3, width: 120 })).toBe(
      '[1:v]format=rgba,colorchannelmixer=aa=0.3,scale=120:-1[wm];[0:v][wm]overlay=0:0[out]',
    );
  });
});

describe('overlay', () => {
  let dir: string;
  let watermark: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-overlay-'));
    watermark = join(dir, 'wm.png');
    // A 100x50 solid PNG is enough to exercise the overlay path.
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=red:size=100x50',
      '-frames:v', '1', watermark,
    ]);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('burns a watermark and keeps the dimensions, duration and audio', async () => {
    const output = join(dir, 'out.mp4');
    await overlay(SAMPLE, output, { watermark, position: 'top-right', opacity: 0.7, width: 80 });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.video?.width).toBe(1280); // frame size untouched by the overlay
    expect(info.video?.height).toBe(720);
    expect(info.audio?.codec).toBe('aac'); // audio copied through
    expect(info.duration).toBeCloseTo(10, 0);
  }, 60_000);

  it('reports progress between 0 and 100', async () => {
    const output = join(dir, 'out-progress.mp4');
    const percents: number[] = [];
    await overlay(SAMPLE, output, { watermark, onProgress: (p) => percents.push(p.percent) });

    expect(percents.length).toBeGreaterThan(0);
    expect(Math.min(...percents)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
  }, 60_000);

  it('handles a video with no audio track', async () => {
    const silent = join(dir, 'silent.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', SAMPLE, '-an', '-c:v', 'libx264', silent]);

    const output = join(dir, 'out-silent.mp4');
    await overlay(silent, output, { watermark });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.audio).toBeNull();
  }, 60_000);

  it('throws InvalidOptionsError for an out-of-range opacity', async () => {
    await expect(overlay(SAMPLE, join(dir, 'x.mp4'), { watermark, opacity: 2 })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('throws InvalidFormatError when the watermark is not an image', async () => {
    await expect(overlay(SAMPLE, join(dir, 'x.mp4'), { watermark: SAMPLE })).rejects.toBeInstanceOf(
      InvalidFormatError,
    );
  });

  it('throws InvalidFormatError when the output is not an .mp4', async () => {
    await expect(overlay(SAMPLE, join(dir, 'x.mkv'), { watermark })).rejects.toBeInstanceOf(
      InvalidFormatError,
    );
  });

  it('throws FileNotFoundError when the watermark is missing', async () => {
    await expect(
      overlay(SAMPLE, join(dir, 'x.mp4'), { watermark: join(dir, 'nope.png') }),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });
});
