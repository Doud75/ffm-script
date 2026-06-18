import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parallelConvert, resolveWorkers } from '../src/operations/parallel.js';
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

describe('resolveWorkers', () => {
  it('defaults to half the logical cores (at least 1)', () => {
    expect(resolveWorkers(undefined, 8)).toBe(4);
    expect(resolveWorkers(undefined, 16)).toBe(8);
    expect(resolveWorkers(undefined, 1)).toBe(1); // single-core host still gets one worker
    expect(resolveWorkers(undefined, 3)).toBe(1); // floor(3/2)
  });

  it('keeps a requested count within the core budget', () => {
    expect(resolveWorkers(3, 8)).toBe(3);
    expect(resolveWorkers(8, 8)).toBe(8);
  });

  it('caps a requested count at the core count to avoid oversubscription', () => {
    expect(resolveWorkers(32, 8)).toBe(8);
  });

  it('throws InvalidOptionsError for a non-positive or non-integer count', () => {
    expect(() => resolveWorkers(0, 8)).toThrow(InvalidOptionsError);
    expect(() => resolveWorkers(-2, 8)).toThrow(InvalidOptionsError);
    expect(() => resolveWorkers(2.5, 8)).toThrow(InvalidOptionsError);
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

  it('falls back to frame-boundary cuts for an all-intra input (no stss box)', async () => {
    const allIntra = join(dir, 'allintra.mp4');
    // -g 1 makes every frame a keyframe; the muxer omits the stss box.
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', SAMPLE, '-g', '1', '-c:a', 'aac', allIntra]);

    const output = join(dir, 'out-allintra.mp4');
    await parallelConvert(allIntra, output, { workers: 4, targetBitrate: '800k' });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.duration).toBeCloseTo(10, 0);
  }, 60_000);

  it('accepts a non-MP4 container (MKV) via ffprobe keyframes', async () => {
    const mkv = join(dir, 'in.mkv');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', SAMPLE, '-c', 'copy', mkv]);

    const output = join(dir, 'out-mkv.mp4');
    await parallelConvert(mkv, output, { workers: 4, targetBitrate: '800k' });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.duration).toBeCloseTo(10, 0); // full length preserved across joins
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
