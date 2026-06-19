import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toAnimation } from '../src/operations/animation.js';
import { buildGifFilter, buildWebpFilter } from '../src/core/animation.js';
import { FileNotFoundError, InvalidFormatError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

/** Reads a single stream entry from a (non-probe-able) animation output. */
function streamEntry(file: string, entry: string, countFrames = false): string {
  const args = ['-v', 'error', '-select_streams', 'v:0'];
  if (countFrames) args.push('-count_frames');
  args.push('-show_entries', `stream=${entry}`, '-of', 'default=nw=1:nk=1', file);
  return execFileSync('ffprobe', args).toString().trim();
}

describe('buildGifFilter', () => {
  it('generates and reuses a per-clip palette', () => {
    expect(buildGifFilter(15, undefined)).toBe(
      'fps=15,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
    );
  });

  it('inserts a lanczos scale when a width is given', () => {
    expect(buildGifFilter(10, 240)).toBe(
      'fps=10,scale=240:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
    );
  });
});

describe('buildWebpFilter', () => {
  it('is just the fps/scale chain (no palette)', () => {
    expect(buildWebpFilter(15, undefined)).toBe('fps=15');
    expect(buildWebpFilter(20, 320)).toBe('fps=20,scale=320:-1:flags=lanczos');
  });
});

describe('toAnimation', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-anim-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('renders a GIF of the requested range, fps and width', async () => {
    const out = join(dir, 'clip.gif');
    const percents: number[] = [];
    await toAnimation(SAMPLE, out, {
      start: 0,
      end: 2,
      fps: 10,
      width: 120,
      onProgress: (p) => percents.push(p.percent),
    });

    expect(streamEntry(out, 'codec_name')).toBe('gif');
    expect(streamEntry(out, 'width')).toBe('120'); // scaled, aspect preserved
    // 2s at 10fps → ~20 frames; allow a little encoder slack.
    expect(Number(streamEntry(out, 'nb_read_frames', true))).toBeGreaterThanOrEqual(18);
    expect(percents.length).toBeGreaterThan(0);
    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
  }, 60_000);

  it('renders an animated WebP', async () => {
    const out = join(dir, 'clip.webp');
    await toAnimation(SAMPLE, out, { start: 0, end: 2, fps: 10, width: 160 });

    expect(streamEntry(out, 'codec_name')).toBe('webp');
    expect(statSync(out).size).toBeGreaterThan(0);
  }, 60_000);

  it('defaults to the whole input when no range is given', async () => {
    const out = join(dir, 'full.gif');
    await toAnimation(SAMPLE, out, { fps: 5, width: 80 });

    expect(streamEntry(out, 'codec_name')).toBe('gif');
    // 10s sample at 5fps → ~50 frames, far more than a short clip would yield.
    expect(Number(streamEntry(out, 'nb_read_frames', true))).toBeGreaterThan(40);
  }, 60_000);

  it('throws InvalidFormatError for an unsupported output extension', async () => {
    await expect(toAnimation(SAMPLE, join(dir, 'x.mp4'))).rejects.toBeInstanceOf(InvalidFormatError);
  });

  it('throws InvalidOptionsError when end is not after start', async () => {
    await expect(toAnimation(SAMPLE, join(dir, 'x.gif'), { start: 5, end: 5 })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('throws InvalidOptionsError for a non-positive fps', async () => {
    await expect(toAnimation(SAMPLE, join(dir, 'x.gif'), { fps: 0 })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('throws FileNotFoundError when the input is missing', async () => {
    await expect(toAnimation(join(dir, 'nope.mp4'), join(dir, 'x.gif'))).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
  });
});
