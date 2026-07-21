import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audioToHLS, toHLS } from '../src/operations/hls.js';
import { extractAudio } from '../src/operations/extract.js';
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
      toHLS(join(dir, 'nope.mp4'), join(dir, 'x'), {
        resolutions: [{ width: 320, bitrate: '400k' }],
      }),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('packages fMP4/CMAF segments with a per-variant init segment', async () => {
    const out = join(dir, 'hls-fmp4');
    await toHLS(SAMPLE, out, {
      segmentDuration: 2,
      segmentType: 'fmp4',
      resolutions: [{ width: 320, bitrate: '400k' }],
    });

    expect(existsSync(join(out, 'master.m3u8'))).toBe(true);
    expect(existsSync(join(out, '320', 'init.mp4'))).toBe(true);
    const segments = readdirSync(join(out, '320')).filter((f) => f.endsWith('.m4s'));
    expect(segments.length).toBeGreaterThan(0);
  }, 60_000);
});

describe('audioToHLS', () => {
  let dir: string;
  let audio: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-ahls-'));
    // Derive an audio-only input from the sample — no committed audio fixture.
    audio = join(dir, 'in.m4a');
    await extractAudio(SAMPLE, audio, { codec: 'aac' });
  }, 60_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('produces a master playlist and per-bitrate variant segments', async () => {
    const out = join(dir, 'ahls');
    await audioToHLS(audio, out, { segmentDuration: 2, bitrates: ['128k', '64k'] });

    const master = join(out, 'master.m3u8');
    expect(existsSync(master)).toBe(true);
    expect(readFileSync(master, 'utf8').match(/#EXT-X-STREAM-INF/g)?.length).toBe(2);

    // Each variant folder is named after its bitrate and holds a playlist + segments.
    for (const name of ['128k', '64k']) {
      expect(existsSync(join(out, name, 'playlist.m3u8'))).toBe(true);
      const segments = readdirSync(join(out, name)).filter((f) => f.endsWith('.ts'));
      expect(segments.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('still writes a master playlist for a single default bitrate', async () => {
    const out = join(dir, 'ahls-single');
    await audioToHLS(audio, out);

    expect(existsSync(join(out, 'master.m3u8'))).toBe(true);
    expect(existsSync(join(out, '128k', 'playlist.m3u8'))).toBe(true);
  }, 60_000);

  it('packages fMP4/CMAF segments with a per-variant init segment', async () => {
    const out = join(dir, 'ahls-fmp4');
    await audioToHLS(audio, out, { segmentDuration: 2, segmentType: 'fmp4', bitrates: ['128k'] });

    expect(existsSync(join(out, '128k', 'init.mp4'))).toBe(true);
    const segments = readdirSync(join(out, '128k')).filter((f) => f.endsWith('.m4s'));
    expect(segments.length).toBeGreaterThan(0);
  }, 60_000);

  it('reports progress between 0 and 100', async () => {
    const out = join(dir, 'ahls-progress');
    const percents: number[] = [];
    await audioToHLS(audio, out, { onProgress: (p) => percents.push(p.percent) });

    expect(percents.length).toBeGreaterThan(0);
    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
  }, 60_000);

  it('throws InvalidOptionsError when bitrates is empty', async () => {
    await expect(audioToHLS(audio, join(dir, 'empty'), { bitrates: [] })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('throws FileNotFoundError when the input is missing', async () => {
    await expect(audioToHLS(join(dir, 'nope.m4a'), join(dir, 'x'))).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
  });
});
