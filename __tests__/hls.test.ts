import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toHLS } from '../src/operations/hls.js';
import { FileNotFoundError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

describe('toHLS', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-hls-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('produces a master playlist and per-variant segments', async () => {
    const out = join(dir, 'hls');
    await toHLS(SAMPLE, out, {
      segmentDuration: 2,
      resolutions: [
        { width: 640, bitrate: '800k' },
        { width: 320, bitrate: '400k' },
      ],
    });

    const master = join(out, 'master.m3u8');
    expect(existsSync(master)).toBe(true);
    // One stream entry per variant in the master playlist.
    const masterContent = readFileSync(master, 'utf8');
    expect(masterContent.match(/#EXT-X-STREAM-INF/g)?.length).toBe(2);

    // Each variant folder (named by width) has a playlist + at least one segment.
    for (const name of ['640', '320']) {
      expect(existsSync(join(out, name, 'playlist.m3u8'))).toBe(true);
      const segments = readdirSync(join(out, name)).filter((f) => f.endsWith('.ts'));
      expect(segments.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('reports progress between 0 and 100', async () => {
    const out = join(dir, 'hls-progress');
    const percents: number[] = [];
    await toHLS(SAMPLE, out, {
      resolutions: [{ width: 320, bitrate: '400k' }],
      onProgress: (p) => percents.push(p.percent),
    });

    expect(percents.length).toBeGreaterThan(0);
    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
  }, 60_000);

  it('throws InvalidOptionsError when resolutions is empty', async () => {
    await expect(toHLS(SAMPLE, join(dir, 'empty'), { resolutions: [] })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('throws FileNotFoundError when the input is missing', async () => {
    await expect(
      toHLS(join(dir, 'nope.mp4'), join(dir, 'x'), { resolutions: [{ width: 320, bitrate: '400k' }] }),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });
});
