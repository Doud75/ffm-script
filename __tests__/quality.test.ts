import { statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { qualityArgs, assertQualityBitrateExclusive } from '../src/core/quality.js';
import { convert } from '../src/operations/convert.js';
import { parallelConvert } from '../src/operations/parallel.js';
import { ffmscript } from '../src/operations/chain.js';
import { probe } from '../src/operations/probe.js';
import { InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

describe('qualityArgs', () => {
  it('maps each semantic preset to the matching CRF and speed preset', () => {
    expect(qualityArgs('high')).toEqual(['-crf', '18', '-preset', 'slow']);
    expect(qualityArgs('balanced')).toEqual(['-crf', '23', '-preset', 'medium']);
    expect(qualityArgs('small')).toEqual(['-crf', '28', '-preset', 'medium']);
  });
});

describe('assertQualityBitrateExclusive', () => {
  it('throws when both a quality preset and a bitrate are set', () => {
    expect(() => assertQualityBitrateExclusive('high', '2000k')).toThrow(InvalidOptionsError);
  });

  it('allows either one alone, or neither', () => {
    expect(() => assertQualityBitrateExclusive('high', undefined)).not.toThrow();
    expect(() => assertQualityBitrateExclusive(undefined, '2000k')).not.toThrow();
    expect(() => assertQualityBitrateExclusive(undefined, undefined)).not.toThrow();
  });
});

describe('quality presets (integration)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-quality-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('convert produces a valid MP4 for a quality preset', async () => {
    const output = join(dir, 'small.mp4');
    await convert(SAMPLE, output, { quality: 'small' });

    expect((await probe(output)).video?.codec).toBe('h264');
  }, 30_000);

  it("convert's 'high' preset yields a larger file than 'small'", async () => {
    const high = join(dir, 'q-high.mp4');
    const small = join(dir, 'q-small.mp4');
    await convert(SAMPLE, high, { quality: 'high' });
    await convert(SAMPLE, small, { quality: 'small' });

    // Lower CRF (high) keeps more detail → a bigger file. Proof the CRF is applied.
    expect(statSync(high).size).toBeGreaterThan(statSync(small).size);
  }, 60_000);

  it('convert rejects quality combined with an explicit video bitrate', async () => {
    await expect(
      convert(SAMPLE, join(dir, 'x.mp4'), { quality: 'high', videoBitrate: '2000k' }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('parallelConvert rejects quality combined with a target bitrate', async () => {
    await expect(
      parallelConvert(SAMPLE, join(dir, 'x.mp4'), { quality: 'high', targetBitrate: '2000k' }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('the chainable API rejects quality combined with a video bitrate', async () => {
    await expect(
      ffmscript(SAMPLE)
        .convert({ quality: 'high', videoBitrate: '2000k' })
        .save(join(dir, 'x.mp4')),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('parallelConvert produces a valid MP4 for a quality preset', async () => {
    const output = join(dir, 'parallel-small.mp4');
    await parallelConvert(SAMPLE, output, { quality: 'small', workers: 4 });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.duration).toBeCloseTo(10, 0);
  }, 60_000);
});
