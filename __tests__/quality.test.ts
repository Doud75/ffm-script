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
    expect(qualityArgs('high', 'libx264')).toEqual(['-crf', '18', '-preset', 'slow']);
    expect(qualityArgs('balanced', 'libx264')).toEqual(['-crf', '23', '-preset', 'medium']);
    expect(qualityArgs('small', 'libx264')).toEqual(['-crf', '28', '-preset', 'medium']);
  });

  // Each encoder family exposes constant quality under a different flag and scale,
  // so 'balanced' has to come out as that family's dialect, not x264's -crf.
  it.each([
    ['libx265', ['-crf', '23', '-preset', 'medium']],
    ['h264_nvenc', ['-cq', '23', '-preset', 'p4']],
    ['hevc_qsv', ['-global_quality', '23']],
    ['h264_videotoolbox', ['-q:v', '55']],
    ['h264_vaapi', ['-qp', '23']],
    ['h264_amf', ['-rc', 'cqp', '-qp_i', '23', '-qp_p', '23']],
    ['libvpx-vp9', ['-crf', '31', '-b:v', '0']],
    ['libsvtav1', ['-crf', '35', '-preset', '8']],
    ['libaom-av1', ['-crf', '32', '-b:v', '0', '-cpu-used', '5']],
  ])("expresses 'balanced' in %s's own quality dialect", (encoder, expected) => {
    expect(qualityArgs('balanced', encoder)).toEqual(expected);
  });

  it('matches hardware encoders by API suffix, whatever the codec', () => {
    // One rule per API covers every codec it encodes, present and future.
    expect(qualityArgs('high', 'av1_nvenc')).toEqual(qualityArgs('high', 'h264_nvenc'));
    expect(qualityArgs('small', 'hevc_videotoolbox')).toEqual(
      qualityArgs('small', 'h264_videotoolbox'),
    );
  });

  it('keeps a preset ordering within each family', () => {
    // Lower CRF = better quality; videotoolbox's -q:v scale is inverted.
    expect(qualityArgs('high', 'libvpx-vp9')).toEqual(['-crf', '24', '-b:v', '0']);
    expect(qualityArgs('small', 'libvpx-vp9')).toEqual(['-crf', '37', '-b:v', '0']);
    expect(qualityArgs('high', 'h264_videotoolbox')).toEqual(['-q:v', '65']);
    expect(qualityArgs('small', 'h264_videotoolbox')).toEqual(['-q:v', '40']);
  });

  it('rejects an encoder with no known preset scale', () => {
    // Pushing -crf at an encoder that doesn't take it would only produce a raw
    // FFmpeg failure, so the caller is pointed at videoBitrate instead.
    expect(() => qualityArgs('high', 'mpeg4')).toThrow(InvalidOptionsError);
    expect(() => qualityArgs('high', 'mpeg4')).toThrow(/videoBitrate/);
  });

  it('returns a fresh array, so a caller cannot mutate the preset table', () => {
    const args = qualityArgs('high', 'libx264');
    args.push('-tampered');

    expect(qualityArgs('high', 'libx264')).toEqual(['-crf', '18', '-preset', 'slow']);
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
      parallelConvert(SAMPLE, join(dir, 'x.mp4'), { quality: 'high', videoBitrate: '2000k' }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('the chainable API rejects quality combined with a video bitrate', async () => {
    await expect(
      ffmscript(SAMPLE)
        .convert({ quality: 'high', videoBitrate: '2000k' })
        .save(join(dir, 'x.mp4')),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('convert applies a quality preset to WebM/VP9', async () => {
    const output = join(dir, 'q.webm');
    await convert(SAMPLE, output, { quality: 'small' });

    // VP9 takes CRF under the same option name but needs an explicit `-b:v 0` to
    // mean constant quality — proof the VP9 dialect, not x264's, was emitted.
    expect((await probe(output)).video?.codec).toBe('vp9');
  }, 120_000);

  it('rejects a quality preset on an encoder with no known scale', async () => {
    await expect(
      convert(SAMPLE, join(dir, 'x.mp4'), { quality: 'high', videoCodec: 'mpeg4' }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);

    await expect(
      ffmscript(SAMPLE).convert({ quality: 'high', videoCodec: 'mpeg4' }).save(join(dir, 'x.mp4')),
    ).rejects.toBeInstanceOf(InvalidOptionsError);

    await expect(
      parallelConvert(SAMPLE, join(dir, 'x.mp4'), { quality: 'high', videoCodec: 'mpeg4' }),
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
