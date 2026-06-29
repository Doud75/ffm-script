import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trim } from '../src/operations/trim.js';
import { probe } from '../src/operations/probe.js';
import { FileNotFoundError, InvalidFormatError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

describe('trim', () => {
  let dir: string;
  const input = SAMPLE;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-trim-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('cuts the requested range with stream copy (fast, default)', async () => {
    const output = join(dir, 'fast.mp4');
    await trim(input, output, { start: 2, end: 5 });

    const info = await probe(output);
    expect(info.duration).toBeCloseTo(3, 0); // keyframe-bound tolerance
  }, 30_000);

  it('accepts HH:MM:SS timestamps', async () => {
    const output = join(dir, 'hms.mp4');
    await trim(input, output, { start: '00:00:02', end: '00:00:05' });

    const info = await probe(output);
    expect(info.duration).toBeCloseTo(3, 0);
  }, 30_000);

  it('is frame-accurate in precise mode', async () => {
    const output = join(dir, 'precise.mp4');
    await trim(input, output, { start: 2.5, end: 5.5, mode: 'precise' });

    const info = await probe(output);
    expect(info.duration).toBeCloseTo(3, 1); // re-encode → tight
  }, 30_000);

  it('reports progress between 0 and 100', async () => {
    const output = join(dir, 'progress.mp4');
    const percents: number[] = [];
    await trim(input, output, { start: 0, end: 4, onProgress: (p) => percents.push(p.percent) });

    expect(percents.length).toBeGreaterThan(0);
    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
  }, 30_000);

  it('throws InvalidOptionsError when end is not after start', async () => {
    await expect(trim(input, join(dir, 'bad.mp4'), { start: 5, end: 2 })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('throws InvalidOptionsError on an unparseable timestamp', async () => {
    await expect(
      trim(input, join(dir, 'bad.mp4'), { start: 'abc', end: 5 }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('throws FileNotFoundError when the input is missing', async () => {
    await expect(
      trim(join(dir, 'nope.mp4'), join(dir, 'out.mp4'), { start: 0, end: 1 }),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('throws InvalidFormatError when the output is not an .mp4', async () => {
    await expect(trim(input, join(dir, 'out.mkv'), { start: 0, end: 1 })).rejects.toBeInstanceOf(
      InvalidFormatError,
    );
  });
});
