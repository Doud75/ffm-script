import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convert } from '../src/operations/convert.js';
import { probe } from '../src/operations/probe.js';
import { FileNotFoundError, InvalidFormatError } from '../src/errors/index.js';

describe('convert', () => {
  let dir: string;
  let input: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-convert-'));
    input = join(dir, 'input.mp4');
    execFileSync(
      'ffmpeg',
      [
        '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=2',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
        '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-y', input,
      ],
      { stdio: 'ignore' },
    );
  }, 30_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('produces a valid MP4 with default codecs', async () => {
    const output = join(dir, 'default.mp4');
    await convert(input, output);

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.audio?.codec).toBe('aac');
  }, 30_000);

  it('scales to the requested width while preserving the aspect ratio', async () => {
    const output = join(dir, 'scaled.mp4');
    await convert(input, output, { width: 640 });

    const info = await probe(output);
    expect(info.video?.width).toBe(640);
    expect(info.video?.height).toBe(360);
  }, 30_000);

  it('reports progress between 0 and 100', async () => {
    const output = join(dir, 'progress.mp4');
    const percents: number[] = [];
    await convert(input, output, { onProgress: (p) => percents.push(p.percent) });

    expect(percents.length).toBeGreaterThan(0);
    expect(Math.min(...percents)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
  }, 30_000);

  it('throws FileNotFoundError when the input is missing', async () => {
    await expect(convert(join(dir, 'nope.mp4'), join(dir, 'out.mp4'))).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
  });

  it('throws InvalidFormatError when the output is not an .mp4', async () => {
    await expect(convert(input, join(dir, 'out.mkv'))).rejects.toBeInstanceOf(InvalidFormatError);
  });
});
