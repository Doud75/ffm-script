import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toSprites } from '../src/operations/sprites.js';
import { FileNotFoundError, InvalidFormatError } from '../src/errors/index.js';
import { SAMPLE, makeSilentWav } from './helpers.js';

/**
 * Pixel size of an image, straight from ffprobe — `probe()` only accepts media
 * containers, and a sprite sheet is a still.
 */
function imageSize(file: string): { width?: number; height?: number } {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', file],
    { encoding: 'utf8' },
  );
  const streams = (JSON.parse(out) as { streams?: { width?: number; height?: number }[] }).streams;
  const first = streams?.[0];
  return { width: first?.width, height: first?.height };
}

/** Every sheet referenced by the VTT, in cue order (duplicates kept out). */
function referencedSheets(vtt: string): string[] {
  const matches = vtt.match(/sprite_\d+\.\w+/g) ?? [];
  return [...new Set(matches)];
}

/** Number of `-->` cue timing lines in a WebVTT document. */
function cueCount(vtt: string): number {
  return vtt.match(/ --> /g)?.length ?? 0;
}

describe('toSprites', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-sprites-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('packs the whole input into one sheet with a cue per thumbnail', async () => {
    const out = join(dir, 'single');
    // The sample is 10s, so a 1s interval yields 10 thumbnails — well inside a 5x5 grid.
    await toSprites(SAMPLE, out, { interval: 1 });

    const sheets = readdirSync(out).filter((f) => f.endsWith('.jpg'));
    expect(sheets).toEqual(['sprite_000.jpg']);

    const vtt = readFileSync(join(out, 'storyboard.vtt'), 'utf8');
    expect(vtt.startsWith('WEBVTT\n')).toBe(true);
    expect(cueCount(vtt)).toBe(10);
    // First cue: top-left tile, 160px wide and 90px tall (the sample is 1280x720).
    expect(vtt).toContain('00:00:00.000 --> 00:00:01.000\nsprite_000.jpg#xywh=0,0,160,90');
    // Sixth thumbnail wraps onto the second row of the grid.
    expect(vtt).toContain('00:00:05.000 --> 00:00:06.000\nsprite_000.jpg#xywh=0,90,160,90');
    // No cue runs past the input.
    expect(vtt).toContain('00:00:09.000 --> 00:00:10.000');
  }, 60_000);

  it('writes a sheet sized exactly columns x rows tiles', async () => {
    const out = join(dir, 'geometry');
    await toSprites(SAMPLE, out, { interval: 1, width: 320 });

    // 320px wide tiles keep the 16:9 ratio → 180px tall; the grid is 5x5.
    expect(imageSize(join(out, 'sprite_000.jpg'))).toEqual({ width: 320 * 5, height: 180 * 5 });

    const vtt = readFileSync(join(out, 'storyboard.vtt'), 'utf8');
    expect(vtt).toContain('sprite_000.jpg#xywh=0,0,320,180');
    expect(vtt).toContain('sprite_000.jpg#xywh=320,0,320,180');
  }, 60_000);

  it('spills onto extra sheets and never references a missing one', async () => {
    const out = join(dir, 'multi');
    // 10 thumbnails over a 2x2 grid → 4 + 4 + 2 across three sheets.
    await toSprites(SAMPLE, out, { interval: 1, columns: 2, rows: 2 });

    const sheets = readdirSync(out)
      .filter((f) => f.endsWith('.jpg'))
      .sort();
    expect(sheets).toEqual(['sprite_000.jpg', 'sprite_001.jpg', 'sprite_002.jpg']);

    const vtt = readFileSync(join(out, 'storyboard.vtt'), 'utf8');
    expect(cueCount(vtt)).toBe(10);
    expect(referencedSheets(vtt)).toEqual(sheets);
    for (const sheet of referencedSheets(vtt)) {
      expect(existsSync(join(out, sheet))).toBe(true);
    }
    // The 5th thumbnail opens the second sheet at its top-left corner.
    expect(vtt).toContain('00:00:04.000 --> 00:00:05.000\nsprite_001.jpg#xywh=0,0,160,90');
  }, 60_000);

  it.each(['png', 'webp'] as const)(
    'honours the %s format in both the files and the VTT urls',
    async (format) => {
      const out = join(dir, format);
      await toSprites(SAMPLE, out, { interval: 5, format });

      expect(existsSync(join(out, `sprite_000.${format}`))).toBe(true);
      // A real decodable image, not just a file with the right name.
      expect(imageSize(join(out, `sprite_000.${format}`))).toEqual({ width: 800, height: 450 });

      const vtt = readFileSync(join(out, 'storyboard.vtt'), 'utf8');
      expect(vtt).toContain(`sprite_000.${format}#xywh=0,0,160,90`);
      expect(vtt).not.toContain('.jpg');
    },
    60_000,
  );

  it('reports progress between 0 and 100', async () => {
    const out = join(dir, 'progress');
    const percents: number[] = [];
    await toSprites(SAMPLE, out, { interval: 1, onProgress: (p) => percents.push(p.percent) });

    expect(percents.length).toBeGreaterThan(0);
    expect(Math.min(...percents)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
  }, 60_000);

  it('throws FileNotFoundError when the input does not exist', async () => {
    await expect(toSprites('nope.mp4', join(dir, 'missing'))).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
  });

  it('throws InvalidFormatError on an input without a video stream', async () => {
    const wav = makeSilentWav(dir);
    // Rejected on the extension first, so give it a video container to reach the probe.
    const mp4 = join(dir, 'audio-only.mp4');
    const { run } = await import('../src/operations/run.js');
    await run(['-i', wav, '-c:a', 'aac', '-y', mp4]);

    await expect(toSprites(mp4, join(dir, 'no-video'))).rejects.toBeInstanceOf(InvalidFormatError);
  }, 60_000);
});
