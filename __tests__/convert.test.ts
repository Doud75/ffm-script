import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convert } from '../src/operations/convert.js';
import { probe } from '../src/operations/probe.js';
import { FileNotFoundError, InvalidFormatError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

describe('convert', () => {
  let dir: string;
  const input = SAMPLE;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-convert-'));
  });

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

  it('writes a MOV with the default h264/aac codecs', async () => {
    const output = join(dir, 'out.mov');
    await convert(input, output);

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.audio?.codec).toBe('aac');
  }, 30_000);

  it('writes an MKV with the default h264/aac codecs', async () => {
    const output = join(dir, 'out.mkv');
    await convert(input, output);

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.audio?.codec).toBe('aac');
  }, 30_000);

  it('writes a WebM with container-aware vp9/opus defaults', async () => {
    const output = join(dir, 'out.webm');
    await convert(input, output, { width: 320 }); // smaller frame keeps vp9 fast

    const info = await probe(output);
    expect(info.video?.codec).toBe('vp9');
    expect(info.audio?.codec).toBe('opus');
    expect(info.duration).toBeCloseTo(10, 0);
  }, 60_000);

  it('throws InvalidFormatError for an unsupported output container', async () => {
    await expect(convert(input, join(dir, 'out.avi'))).rejects.toBeInstanceOf(InvalidFormatError);
  });

  it('throws InvalidFormatError for a codec the container cannot carry', async () => {
    await expect(
      convert(input, join(dir, 'bad.webm'), { videoCodec: 'libx264' }),
    ).rejects.toBeInstanceOf(InvalidFormatError);
  });

  it('throws InvalidOptionsError when a quality preset is used with a non-CRF codec', async () => {
    await expect(
      convert(input, join(dir, 'q.webm'), { quality: 'high' }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('rejects with an AbortError when the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      convert(input, join(dir, 'aborted.mp4'), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
