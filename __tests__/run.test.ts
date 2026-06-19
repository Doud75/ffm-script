import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/operations/run.js';
import { probe } from '../src/operations/probe.js';
import { FFmpegError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

describe('run', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-run-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('executes a raw argument list and produces the output', async () => {
    const output = join(dir, 'raw.mp4');
    await run(['-i', SAMPLE, '-vf', 'scale=640:-2', '-y', output]);

    const info = await probe(output);
    expect(info.video?.width).toBe(640);
  }, 30_000);

  it('reports progress when a duration is provided', async () => {
    const output = join(dir, 'progress.mp4');
    const percents: number[] = [];
    await run(['-i', SAMPLE, '-y', output], {
      duration: 10,
      onProgress: (p) => percents.push(p.percent),
    });

    expect(percents.length).toBeGreaterThan(0);
    expect(Math.min(...percents)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
  }, 30_000);

  it('emits no progress when duration is omitted', async () => {
    const output = join(dir, 'no-progress.mp4');
    const percents: number[] = [];
    await run(['-i', SAMPLE, '-y', output], {
      onProgress: (p) => percents.push(p.percent),
    });

    expect(percents).toHaveLength(0);
  }, 30_000);

  it('throws InvalidOptionsError when args is empty', async () => {
    await expect(run([])).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('rejects with FFmpegError when FFmpeg exits non-zero', async () => {
    await expect(
      run(['-i', join(dir, 'nope.mp4'), '-y', join(dir, 'out.mp4')]),
    ).rejects.toBeInstanceOf(FFmpegError);
  }, 30_000);

  it('rejects with an AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      run(['-i', SAMPLE, '-y', join(dir, 'aborted.mp4')], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
