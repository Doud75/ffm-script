import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { concat } from '../src/operations/concat.js';
import { probe } from '../src/operations/probe.js';
import { FileNotFoundError, InvalidFormatError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

describe('concat', () => {
  let dir: string;
  // Same 1280x720 resolution as SAMPLE but a different video codec (mpeg4): the
  // concat demuxer can't stream-copy these together, so `auto` must pick precise.
  let mpeg4Variant: string;
  // SAMPLE with its audio dropped.
  let silent: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-concat-test-'));

    mpeg4Variant = join(dir, 'variant.mp4');
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', SAMPLE,
      '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'copy', mpeg4Variant,
    ]);

    silent = join(dir, 'silent.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', SAMPLE, '-an', '-c:v', 'libx264', silent]);
  }, 60_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('joins identical files with the demuxer into one MP4 of the summed length', async () => {
    const output = join(dir, 'fast.mp4');
    await concat([SAMPLE, SAMPLE], output, { mode: 'fast' });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.audio?.codec).toBe('aac');
    expect(info.duration).toBeCloseTo(20, 0);
  }, 30_000);

  it('auto-joins compatible inputs (demuxer path)', async () => {
    const output = join(dir, 'auto-fast.mp4');
    await concat([SAMPLE, SAMPLE], output);

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.duration).toBeCloseTo(20, 0);
  }, 30_000);

  it('auto re-encodes incompatible inputs (concat filter path)', async () => {
    const output = join(dir, 'auto-precise.mp4');
    await concat([SAMPLE, mpeg4Variant], output);

    const info = await probe(output);
    // Re-encoded to the default h264 — proof the precise path ran, not a copy.
    expect(info.video?.codec).toBe('h264');
    expect(info.duration).toBeCloseTo(20, 0);
  }, 60_000);

  it('precise mode joins heterogeneous inputs', async () => {
    const output = join(dir, 'precise.mp4');
    await concat([SAMPLE, mpeg4Variant], output, { mode: 'precise' });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.audio?.codec).toBe('aac');
    expect(info.duration).toBeCloseTo(20, 0);
  }, 60_000);

  it('precise mode joins inputs that have no audio track', async () => {
    const output = join(dir, 'precise-silent.mp4');
    await concat([silent, silent], output, { mode: 'precise' });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.audio).toBeNull();
    expect(info.duration).toBeCloseTo(20, 0);
  }, 60_000);

  it('reports progress between 0 and 100', async () => {
    const output = join(dir, 'progress.mp4');
    const percents: number[] = [];
    await concat([SAMPLE, mpeg4Variant], output, {
      mode: 'precise',
      onProgress: (p) => percents.push(p.percent),
    });

    expect(percents.length).toBeGreaterThan(0);
    expect(Math.min(...percents)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
  }, 60_000);

  it('throws InvalidOptionsError when precise inputs disagree on having audio', async () => {
    await expect(
      concat([SAMPLE, silent], join(dir, 'mixed.mp4'), { mode: 'precise' }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  }, 30_000);

  it('throws InvalidOptionsError for fewer than two inputs', async () => {
    await expect(concat([SAMPLE], join(dir, 'one.mp4'))).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('throws InvalidFormatError when the output is not an .mp4', async () => {
    await expect(concat([SAMPLE, SAMPLE], join(dir, 'out.mkv'))).rejects.toBeInstanceOf(
      InvalidFormatError,
    );
  });

  it('throws FileNotFoundError when an input is missing', async () => {
    await expect(
      concat([SAMPLE, join(dir, 'nope.mp4')], join(dir, 'out.mp4')),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('rejects with an AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      concat([SAMPLE, SAMPLE], join(dir, 'aborted.mp4'), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
