import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processBatch } from '../src/operations/batch.js';
import { convert } from '../src/operations/convert.js';
import { probe } from '../src/operations/probe.js';
import { InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

/** Resolves after `ms`, then with `value` — used to make tasks finish out of order. */
function delayed<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe('processBatch (orchestration)', () => {
  it('resolves with results in input order regardless of finish order', async () => {
    const items = [30, 10, 20, 0];
    // Longer items finish later, so completion order differs from input order.
    const results = await processBatch(items, (ms, i) => delayed(`${i}:${ms}`, ms));
    expect(results).toEqual(['0:30', '1:10', '2:20', '3:0']);
  });

  it('passes the item and its index to the task', async () => {
    const seen: Array<[string, number]> = [];
    await processBatch(['a', 'b', 'c'], (item, index) => {
      seen.push([item, index]);
      return Promise.resolve();
    });
    expect(seen).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });

  it('bounds concurrency to the requested value', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await processBatch(
      items,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await delayed(null, 10);
        inFlight--;
      },
      { concurrency: 3 },
    );
    expect(peak).toBe(3);
  });

  it('never runs more lanes than there are items', async () => {
    let peak = 0;
    let inFlight = 0;
    await processBatch(
      [1, 2],
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await delayed(null, 5);
        inFlight--;
      },
      { concurrency: 8 },
    );
    expect(peak).toBe(2);
  });

  it('reports progress as (done, total) after each task', async () => {
    const calls: Array<[number, number]> = [];
    await processBatch([1, 2, 3], (n) => delayed(n, n), {
      concurrency: 1,
      onProgress: (done, total) => calls.push([done, total]),
    });
    expect(calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('is fail-fast: the first rejecting task rejects the batch', async () => {
    const boom = new Error('task 1 failed');
    await expect(
      processBatch([0, 1, 2], (n) => (n === 1 ? Promise.reject(boom) : Promise.resolve(n))),
    ).rejects.toBe(boom);
  });

  it('resolves with [] for an empty input and never calls the task or onProgress', async () => {
    let tasks = 0;
    let progressCalls = 0;
    const results = await processBatch(
      [] as number[],
      () => {
        tasks++;
        return Promise.resolve();
      },
      { onProgress: () => progressCalls++ },
    );
    expect(results).toEqual([]);
    expect(tasks).toBe(0);
    expect(progressCalls).toBe(0);
  });

  it('applies the default concurrency when none is given', async () => {
    // No concurrency option → the half-cores default; the batch still completes.
    const results = await processBatch([1, 2, 3, 4], (n) => Promise.resolve(n * 2));
    expect(results).toEqual([2, 4, 6, 8]);
  });

  it.each([0, -1, 2.5])('throws InvalidOptionsError for concurrency %p', async (concurrency) => {
    await expect(
      processBatch([1], (n) => Promise.resolve(n), { concurrency }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('rejects with AbortError and runs nothing when the signal is already aborted', async () => {
    let tasks = 0;
    await expect(
      processBatch(
        [1, 2, 3],
        () => {
          tasks++;
          return Promise.resolve();
        },
        { signal: AbortSignal.abort() },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(tasks).toBe(0);
  });
});

describe('processBatch (e2e)', () => {
  let workDir: string;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'ffm-batch-test-'));
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('converts several files concurrently, writing every output', async () => {
    const widths = [320, 480];
    const outputs = widths.map((w) => join(workDir, `out_${w}.mp4`));

    const progress: Array<[number, number]> = [];
    await processBatch(
      widths,
      (width, i) => convert(SAMPLE, outputs[i]!, { quality: 'small', width }),
      { concurrency: 2, onProgress: (done, total) => progress.push([done, total]) },
    );

    for (const output of outputs) {
      expect(existsSync(output)).toBe(true);
      const info = await probe(output);
      expect(info.video).not.toBeNull();
    }
    expect(progress.at(-1)).toEqual([widths.length, widths.length]);
  }, 60_000);
});
