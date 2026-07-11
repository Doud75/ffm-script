import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parallelConvert,
  resolveWorkers,
  resolveConcurrency,
  resolveRetries,
  resolveRetryDelay,
  planSegmentCount,
  aggregateProgress,
} from '../src/operations/parallel.js';
import { planSegments } from '../src/core/segments.js';
import type { SegmentExecutor } from '../src/core/segments.js';
import { probe } from '../src/operations/probe.js';
import { FileNotFoundError, InvalidFormatError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

describe('planSegments', () => {
  const keyframes = Array.from({ length: 10 }, (_, i) => ({ timestamp: i }));

  it('splits on keyframes into at most segmentCount segments', () => {
    const segments = planSegments(keyframes, { segmentCount: 4 });
    expect(segments).toHaveLength(4);
    expect(segments[0]).toEqual({ index: 0, startTime: 0, endTime: 2 });
    expect(segments[3]).toEqual({ index: 3, startTime: 7 }); // last → to EOF
    // contiguous: each endTime is the next startTime
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.startTime).toBe(segments[i - 1]!.endTime);
    }
  });

  it('never produces more segments than keyframes', () => {
    expect(planSegments([{ timestamp: 0 }], { segmentCount: 8 })).toHaveLength(1);
    expect(planSegments([], { segmentCount: 4 })).toHaveLength(0);
  });
});

describe('planSegmentCount', () => {
  it('oversubscribes the pool for long videos (more segments than workers)', () => {
    // 10 min, plenty of keyframes → SEGMENTS_PER_WORKER (3) per worker.
    expect(planSegmentCount(4, 600, 600)).toBe(12);
    expect(planSegmentCount(8, 600, 600)).toBe(24);
  });

  it('keeps chunks at least MIN_CHUNK_SECONDS long', () => {
    // 30s / 5s = 6 max chunks, below the 12 the pool would otherwise want.
    expect(planSegmentCount(4, 30, 30)).toBe(6);
  });

  it('still uses every worker on short videos', () => {
    // 10s would cap at 2 by min-chunk, but we never go below the worker count.
    expect(planSegmentCount(4, 10, 10)).toBe(4);
  });

  it('never asks for more segments than there are keyframes', () => {
    expect(planSegmentCount(8, 600, 5)).toBe(5);
  });
});

describe('aggregateProgress', () => {
  it('weights each segment by duration, not by its own percentage', () => {
    // Segment A (30s) fully done, segment B (10s) untouched, total 40s.
    // Duration-weighted → 30/40 = 75%. A naive average of percentages would be
    // (100% + 0%) / 2 = 50%, which would under-report the work actually done.
    expect(aggregateProgress([30, 0], 40).percent).toBe(75);
    expect(aggregateProgress([15, 5], 40).percent).toBe(50);
  });

  it('reports the summed processed seconds and the total', () => {
    expect(aggregateProgress([15, 5], 40)).toEqual({
      percent: 50,
      currentTime: 20,
      totalTime: 40,
    });
  });

  it('clamps to 100 and handles a zero total', () => {
    expect(aggregateProgress([30, 30], 40).percent).toBe(100); // over-run clamped
    expect(aggregateProgress([0], 0).percent).toBe(0); // no division by zero
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

describe('resolveConcurrency', () => {
  it('falls back to the core-based default when omitted', () => {
    expect(resolveConcurrency(undefined, 4)).toBe(4);
  });

  it('honours a requested count without capping it to the local cores', () => {
    expect(resolveConcurrency(3, 4)).toBe(3);
    // Remote workers aren't bound by this machine's CPU — no cap, unlike resolveWorkers.
    expect(resolveConcurrency(100, 4)).toBe(100);
  });

  it('throws InvalidOptionsError for a non-positive or non-integer count', () => {
    expect(() => resolveConcurrency(0, 4)).toThrow(InvalidOptionsError);
    expect(() => resolveConcurrency(-1, 4)).toThrow(InvalidOptionsError);
    expect(() => resolveConcurrency(2.5, 4)).toThrow(InvalidOptionsError);
  });
});

describe('resolveRetries', () => {
  it('defaults to 0 (a single attempt) when omitted', () => {
    expect(resolveRetries(undefined)).toBe(0);
  });

  it('accepts a non-negative integer', () => {
    expect(resolveRetries(0)).toBe(0);
    expect(resolveRetries(3)).toBe(3);
  });

  it('throws InvalidOptionsError for a negative or non-integer count', () => {
    expect(() => resolveRetries(-1)).toThrow(InvalidOptionsError);
    expect(() => resolveRetries(1.5)).toThrow(InvalidOptionsError);
  });
});

describe('resolveRetryDelay', () => {
  it('defaults to 0 when omitted', () => {
    expect(resolveRetryDelay(undefined)).toBe(0);
  });

  it('accepts a non-negative number of milliseconds', () => {
    expect(resolveRetryDelay(0)).toBe(0);
    expect(resolveRetryDelay(250)).toBe(250);
  });

  it('throws InvalidOptionsError for a negative or non-finite delay', () => {
    expect(() => resolveRetryDelay(-1)).toThrow(InvalidOptionsError);
    expect(() => resolveRetryDelay(Number.POSITIVE_INFINITY)).toThrow(InvalidOptionsError);
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
      videoBitrate: '800k',
      onProgress: (p) => percents.push(p.percent),
    });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.duration).toBeCloseTo(10, 0); // full length preserved across joins
    expect(percents.length).toBeGreaterThan(0);
    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
    // Aggregated progress never goes backwards and climbs to near-completion.
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]!).toBeGreaterThanOrEqual(percents[i - 1]!);
    }
    expect(Math.max(...percents)).toBeGreaterThan(90);
  }, 60_000);

  it('applies a quality preset (CRF) to every chunk', async () => {
    const output = join(dir, 'out-quality.mp4');
    await parallelConvert(SAMPLE, output, { workers: 2, quality: 'small' });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.duration).toBeCloseTo(10, 0);
  }, 60_000);

  it('scales every chunk to the requested width while preserving the aspect ratio', async () => {
    const output = join(dir, 'out-scaled.mp4');
    // Many workers → many chunks, all of which must land on the same resolution
    // for the concat demuxer to stream-copy the joins. A mismatch would corrupt
    // the output or trip ffprobe; a uniform 640x360 across the full length proves
    // the scale filter is applied identically to each chunk.
    await parallelConvert(SAMPLE, output, { workers: 4, width: 640 });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.video?.width).toBe(640);
    expect(info.video?.height).toBe(360); // aspect ratio preserved via -2
    expect(info.duration).toBeCloseTo(10, 0); // joins held across resolutions
  }, 60_000);

  it('falls back to frame-boundary cuts for an all-intra input (no stss box)', async () => {
    const allIntra = join(dir, 'allintra.mp4');
    // -g 1 makes every frame a keyframe; the muxer omits the stss box.
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      SAMPLE,
      '-g',
      '1',
      '-c:a',
      'aac',
      allIntra,
    ]);

    const output = join(dir, 'out-allintra.mp4');
    await parallelConvert(allIntra, output, { workers: 4, videoBitrate: '800k' });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.duration).toBeCloseTo(10, 0);
  }, 60_000);

  it('keeps audio and video aligned at the junctions (no drift, no A/V offset)', async () => {
    const output = join(dir, 'out-continuity.mp4');
    // Many workers → many junctions: any drift or desync would accumulate here.
    await parallelConvert(SAMPLE, output, { workers: 6, videoBitrate: '800k' });

    const streams = (
      JSON.parse(
        execFileSync('ffprobe', [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,start_time,duration',
          '-of',
          'json',
          output,
        ]).toString(),
      ) as { streams: { codec_type: string; start_time: string; duration: string }[] }
    ).streams;

    const video = streams.find((s) => s.codec_type === 'video')!;
    const audio = streams.find((s) => s.codec_type === 'audio')!;

    // Both tracks start at (essentially) zero — no A/V desync at the head.
    expect(Number(video.start_time)).toBeLessThan(0.02);
    expect(Number(audio.start_time)).toBeLessThan(0.02);

    // Audio and video durations stay within one AAC frame of each other, no matter
    // how many junctions there are — the single-pass audio cannot drift.
    expect(Math.abs(Number(video.duration) - Number(audio.duration))).toBeLessThan(0.05);
  }, 60_000);

  it('handles an input with no audio track', async () => {
    const silent = join(dir, 'silent.mp4');
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      SAMPLE,
      '-an',
      '-c:v',
      'libx264',
      silent,
    ]);

    const output = join(dir, 'out-silent.mp4');
    await parallelConvert(silent, output, { workers: 4, videoBitrate: '800k' });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.audio).toBeNull();
    expect(info.duration).toBeCloseTo(10, 0);
  }, 60_000);

  it('accepts a non-MP4 container (MKV) via ffprobe keyframes', async () => {
    const mkv = join(dir, 'in.mkv');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', SAMPLE, '-c', 'copy', mkv]);

    const output = join(dir, 'out-mkv.mp4');
    await parallelConvert(mkv, output, { workers: 4, videoBitrate: '800k' });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.duration).toBeCloseTo(10, 0); // full length preserved across joins
  }, 60_000);

  it('threads an abort signal through the whole pipeline (transcode, concat, audio, mux)', async () => {
    const output = join(dir, 'out-signal.mp4');
    const controller = new AbortController();

    // A fresh, never-aborted signal exercises every `signal` spread along the
    // pipeline on a real run that still completes successfully.
    await parallelConvert(SAMPLE, output, {
      workers: 4,
      videoBitrate: '800k',
      signal: controller.signal,
    });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.audio?.codec).toBe('aac');
    expect(info.duration).toBeCloseTo(10, 0);
  }, 60_000);

  it('throws InvalidOptionsError for a non-positive worker count', async () => {
    await expect(
      parallelConvert(SAMPLE, join(dir, 'x.mp4'), { workers: 0 }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('routes every chunk through a custom executor and joins the returned chunks', async () => {
    const output = join(dir, 'out-executor.mp4');
    const calls: {
      index: number;
      duration: number;
      hasSignal: boolean;
      encodeArgs: string[];
    }[] = [];
    const controller = new AbortController();

    // A user-supplied executor builds the full command from the public contract
    // (input + encodeArgs + segment timing) and returns the chunk path — the same
    // shape a remote worker would use, exercised locally here.
    const executor: SegmentExecutor = (segment, ctx) => {
      calls.push({
        index: segment.index,
        duration: ctx.duration,
        hasSignal: ctx.signal !== undefined,
        encodeArgs: ctx.encodeArgs,
      });
      const chunk = join(dir, `exec_chunk_${String(segment.index)}.mp4`);
      execFileSync('ffmpeg', [
        '-loglevel',
        'error',
        '-ss',
        String(segment.startTime),
        '-i',
        ctx.input,
        ...(segment.endTime !== undefined ? ['-t', String(ctx.duration)] : []),
        ...ctx.encodeArgs,
        '-y',
        chunk,
      ]);
      return Promise.resolve(chunk);
    };

    await parallelConvert(SAMPLE, output, {
      executor,
      concurrency: 3,
      videoBitrate: '800k',
      signal: controller.signal,
    });

    // `concurrency` (not the local core count) drives the split:
    // planSegmentCount(3, 10, keyframes) → 3 segments.
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.index).sort((a, b) => a - b)).toEqual([0, 1, 2]);
    for (const c of calls) {
      // The shared encode contract is passed through, bitrate included.
      expect(c.encodeArgs).toEqual(
        expect.arrayContaining(['-an', '-c:v', 'libx264', '-b:v', '800k']),
      );
      expect(c.duration).toBeGreaterThan(0);
      expect(c.hasSignal).toBe(true); // the abort signal reaches the executor
    }

    // The chunks the executor produced are joined into a valid, full-length MP4,
    // with the audio still encoded in one local pass and muxed back.
    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.audio?.codec).toBe('aac');
    expect(info.duration).toBeCloseTo(10, 0);
  }, 60_000);

  it('propagates an executor failure (and still cleans up)', async () => {
    const boom = new Error('remote worker exploded');
    const executor: SegmentExecutor = () => Promise.reject(boom);
    await expect(
      parallelConvert(SAMPLE, join(dir, 'x.mp4'), { executor, concurrency: 2 }),
    ).rejects.toBe(boom);
  });

  it('retries a failed segment and completes when the retry succeeds', async () => {
    const output = join(dir, 'out-retry.mp4');
    const attempts = new Map<number, number>();

    // Each segment fails on its first attempt, then succeeds — a transient remote
    // failure that `retries` should paper over.
    const executor: SegmentExecutor = (segment, ctx) => {
      const n = (attempts.get(segment.index) ?? 0) + 1;
      attempts.set(segment.index, n);
      if (n === 1) return Promise.reject(new Error('transient worker failure'));
      const chunk = join(dir, `retry_chunk_${String(segment.index)}.mp4`);
      execFileSync('ffmpeg', [
        '-loglevel',
        'error',
        '-ss',
        String(segment.startTime),
        '-i',
        ctx.input,
        ...(segment.endTime !== undefined ? ['-t', String(ctx.duration)] : []),
        ...ctx.encodeArgs,
        '-y',
        chunk,
      ]);
      return Promise.resolve(chunk);
    };

    await parallelConvert(SAMPLE, output, {
      executor,
      concurrency: 2, // → 2 segments
      videoBitrate: '800k',
      retries: 1,
      retryDelay: 10, // exercises the inter-attempt wait
      signal: new AbortController().signal, // fresh signal → the wait is signal-aware but never fires
    });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.duration).toBeCloseTo(10, 0);
    // Every segment was attempted exactly twice: one failure, one success.
    expect(attempts.size).toBe(2);
    expect([...attempts.values()].every((v) => v === 2)).toBe(true);
  }, 60_000);

  it('gives up after exhausting the retries', async () => {
    const boom = new Error('worker permanently down');
    let calls = 0;
    const executor: SegmentExecutor = () => {
      calls++;
      return Promise.reject(boom);
    };
    await expect(
      parallelConvert(SAMPLE, join(dir, 'x.mp4'), { executor, concurrency: 2, retries: 2 }),
    ).rejects.toBe(boom);
    // At least retries + 1 attempts were made on the failing segment before giving up.
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('never retries an abort-shaped failure, even with retries set', async () => {
    const attempts = new Map<number, number>();
    const executor: SegmentExecutor = (segment) => {
      attempts.set(segment.index, (attempts.get(segment.index) ?? 0) + 1);
      return Promise.reject(new DOMException('Operation aborted', 'AbortError'));
    };
    await expect(
      parallelConvert(SAMPLE, join(dir, 'x.mp4'), { executor, concurrency: 2, retries: 3 }),
    ).rejects.toBeInstanceOf(DOMException);
    // Aborts are intentional, so each segment is attempted once and never retried.
    expect([...attempts.values()].every((v) => v === 1)).toBe(true);
  });

  it('stops retrying once the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const attempts = new Map<number, number>();
    const executor: SegmentExecutor = (segment) => {
      attempts.set(segment.index, (attempts.get(segment.index) ?? 0) + 1);
      return Promise.reject(new Error('worker error'));
    };
    await expect(
      parallelConvert(SAMPLE, join(dir, 'x.mp4'), {
        executor,
        concurrency: 2,
        retries: 3,
        signal: controller.signal,
      }),
    ).rejects.toBeTruthy();
    // With the run already aborted, the executor's failure is not retried — each
    // segment is attempted once (the run rejects; which error wins the race doesn't
    // matter, only that no retry happened).
    expect([...attempts.values()].every((v) => v === 1)).toBe(true);
  });

  it('writes an MKV output by stream-copying the h264/aac joins', async () => {
    const output = join(dir, 'out-container.mkv');
    await parallelConvert(SAMPLE, output, { workers: 4, videoBitrate: '800k' });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.audio?.codec).toBe('aac');
    expect(info.duration).toBeCloseTo(10, 0);
  }, 60_000);

  it('writes a MOV output', async () => {
    const output = join(dir, 'out-container.mov');
    await parallelConvert(SAMPLE, output, { workers: 4, videoBitrate: '800k' });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.duration).toBeCloseTo(10, 0);
  }, 60_000);

  it('throws InvalidFormatError for a WebM output (copy pipeline produces h264/aac)', async () => {
    await expect(parallelConvert(SAMPLE, join(dir, 'x.webm'))).rejects.toBeInstanceOf(
      InvalidFormatError,
    );
  });

  it('throws InvalidFormatError for an unsupported output container', async () => {
    await expect(parallelConvert(SAMPLE, join(dir, 'x.avi'))).rejects.toBeInstanceOf(
      InvalidFormatError,
    );
  });

  it('throws FileNotFoundError when the input is missing', async () => {
    await expect(parallelConvert(join(dir, 'nope.mp4'), join(dir, 'x.mp4'))).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
  });
});
