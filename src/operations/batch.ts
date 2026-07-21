import { cpus } from 'node:os';
import { runPool, resolveConcurrency } from '../core/pool.js';
import type { BatchOptions } from '../types/index.js';

/**
 * Runs an async `task` over every item in `items`, with at most `concurrency`
 * tasks in flight at once, and resolves with each task's result **in input
 * order** — regardless of the order they finish in.
 *
 * The generic building block for batch media work: `parallelConvert` parallelises
 * the chunks of *one* file, whereas `processBatch` applies an operation across
 * *many* files (or any async unit of work) with a bounded pool. The task is
 * arbitrary, so it composes with any operation:
 *
 * ```ts
 * const infos = await processBatch(files, (file) => convert(file, out(file), { quality: 'balanced' }), {
 *   concurrency: 4,
 *   onProgress: (done, total) => console.log(`${done}/${total}`),
 * });
 * ```
 *
 * **Fail-fast:** the first task to reject rejects the whole batch (like
 * `Promise.all`). Tasks already in flight are *not* cancelled by this function —
 * wire your own `signal` into `task` if you need to stop work mid-flight.
 *
 * @typeParam T - The item type each task consumes.
 * @typeParam R - The result type each task produces.
 * @param items - The work items; an empty array resolves with `[]` without calling `task`.
 * @param task - Async work for one item, given the item and its index. Its resolved value lands at the same index in the result.
 * @param options - Concurrency, progress and abort options.
 * @returns The task results, one per item, in the order of `items`.
 * @throws {InvalidOptionsError} when `concurrency` is not a positive integer.
 * @throws Whatever the first failing `task` rejects with.
 */
export async function processBatch<T, R>(
  items: T[],
  task: (item: T, index: number) => Promise<R>,
  options: BatchOptions = {},
): Promise<R[]> {
  const concurrency = resolveConcurrency(
    options.concurrency,
    Math.max(1, Math.floor(cpus().length / 2)),
  );

  const results = new Array<R>(items.length);
  const indexed = items.map((item, index) => ({ item, index }));
  let done = 0;

  await runPool(indexed, concurrency, async ({ item, index }) => {
    // Stop launching new tasks once aborted; in-flight tasks keep their own
    // signal wiring. Consistent with the AbortError the rest of the lib rejects with.
    if (options.signal?.aborted === true) {
      throw new DOMException('Operation aborted', 'AbortError');
    }
    results[index] = await task(item, index);
    done++;
    options.onProgress?.(done, items.length);
  });

  return results;
}
