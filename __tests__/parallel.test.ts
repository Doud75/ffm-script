import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parallelConvert } from '../src/operations/parallel.js';
import { planSegments } from '../src/core/segments.js';
import { probe } from '../src/operations/probe.js';
import { FileNotFoundError, InvalidFormatError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

describe('planSegments', () => {
  const keyframes = Array.from({ length: 10 }, (_, i) => ({ timestamp: i }));

  it('splits on keyframes into at most workerCount segments', () => {
    const segments = planSegments(keyframes, { workerCount: 4 });
    expect(segments).toHaveLength(4);
    expect(segments[0]).toEqual({ index: 0, startTime: 0, endTime: 2 });
    expect(segments[3]).toEqual({ index: 3, startTime: 7 }); // last → to EOF
    // contiguous: each endTime is the next startTime
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.startTime).toBe(segments[i - 1]!.endTime);
    }
  });

  it('never produces more segments than keyframes', () => {
    expect(planSegments([{ timestamp: 0 }], { workerCount: 8 })).toHaveLength(1);
    expect(planSegments([], { workerCount: 4 })).toHaveLength(0);
  });
});

describe('parallelConvert', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-pconv-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('transcodes in parallel and concatenates to a valid MP4 of the same length', async () => {
    const output = join(dir, 'out.mp4');
    const percents: number[] = [];
    await parallelConvert(SAMPLE, output, {
      workers: 4,
      targetBitrate: '800k',
      onProgress: (p) => percents.push(p.percent),
    });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.duration).toBeCloseTo(10, 0); // full length preserved across joins
    expect(percents.length).toBeGreaterThan(0);
    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
  }, 60_000);

  it('throws InvalidOptionsError for a non-positive worker count', async () => {
    await expect(parallelConvert(SAMPLE, join(dir, 'x.mp4'), { workers: 0 })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('throws InvalidFormatError when the output is not an .mp4', async () => {
    await expect(parallelConvert(SAMPLE, join(dir, 'x.mkv'))).rejects.toBeInstanceOf(
      InvalidFormatError,
    );
  });

  it('throws FileNotFoundError when the input is missing', async () => {
    await expect(parallelConvert(join(dir, 'nope.mp4'), join(dir, 'x.mp4'))).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
  });
});
