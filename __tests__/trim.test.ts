import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trim } from '../src/operations/trim.js';
import { probe } from '../src/operations/probe.js';
import { FileNotFoundError, InvalidFormatError, InvalidOptionsError } from '../src/errors/index.js';

describe('trim', () => {
  let dir: string;
  let input: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-trim-'));
    input = join(dir, 'input.mp4');
    // 10s source with a keyframe every second (-g 30 @ 30fps) so fast cuts stay tight.
    execFileSync(
      'ffmpeg',
      [
        '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=10',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
        '-c:v', 'libx264', '-g', '30', '-c:a', 'aac', '-shortest', '-y', input,
      ],
      { stdio: 'ignore' },
    );
  }, 30_000);

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
    await expect(
      trim(input, join(dir, 'out.mkv'), { start: 0, end: 1 }),
    ).rejects.toBeInstanceOf(InvalidFormatError);
  });
});
