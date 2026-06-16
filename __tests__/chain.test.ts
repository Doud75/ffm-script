import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmscript } from '../src/operations/chain.js';
import { probe } from '../src/operations/probe.js';
import { FileNotFoundError, InvalidFormatError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

describe('ffmscript (chainable API)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-chain-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('fuses trim + convert into a single pass', async () => {
    const output = join(dir, 'fused.mp4');
    await ffmscript(SAMPLE).trim({ start: 2, end: 5 }).convert({ width: 640 }).save(output);

    const info = await probe(output);
    expect(info.duration).toBeCloseTo(3, 0);
    expect(info.video?.width).toBe(640);
    expect(info.video?.height).toBe(360);
  }, 30_000);

  it('works with convert only', async () => {
    const output = join(dir, 'convert-only.mp4');
    await ffmscript(SAMPLE).convert({ width: 320 }).save(output);

    expect((await probe(output)).video?.width).toBe(320);
  }, 30_000);

  it('works with trim only and reports progress', async () => {
    const output = join(dir, 'trim-only.mp4');
    const percents: number[] = [];
    await ffmscript(SAMPLE)
      .trim({ start: 0, end: 4 })
      .save(output, { onProgress: (p) => percents.push(p.percent) });

    expect((await probe(output)).duration).toBeCloseTo(4, 0);
    expect(percents.length).toBeGreaterThan(0);
    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
  }, 30_000);

  it('throws InvalidOptionsError when nothing was queued', async () => {
    await expect(ffmscript(SAMPLE).save(join(dir, 'empty.mp4'))).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('throws InvalidFormatError when the output is not an .mp4', async () => {
    await expect(
      ffmscript(SAMPLE).convert({ width: 320 }).save(join(dir, 'out.mkv')),
    ).rejects.toBeInstanceOf(InvalidFormatError);
  });

  it('throws FileNotFoundError when the input is missing', async () => {
    await expect(
      ffmscript(join(dir, 'nope.mp4')).convert({ width: 320 }).save(join(dir, 'out.mp4')),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });
});
