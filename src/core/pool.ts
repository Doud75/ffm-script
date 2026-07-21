import { InvalidOptionsError } from '../errors/index.js';

/**
 * Runs `task` over `items` with at most `concurrency` in flight at once. Each lane
 * pulls the next item as soon as it is free, so longer tasks don't stall the rest.
 *
 * Shared bounded-concurrency engine behind both `parallelConvert` (encoding the
 * chunks of one file) and `processBatch` (running an operation over many files).
 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index]!);
    }
  });
  await Promise.all(lanes);
}

/**
 * Resolves how many tasks a pool runs at once. Falls back to `fallback` (a
 * caller-chosen default) when omitted. Unlike a worker count bound to the local
 * CPU, it is **not** capped: a distributed consumer (remote encoders in
 * `parallelConvert`, independent files in `processBatch`) isn't limited by this
 * machine's core count.
 *
 * @throws {InvalidOptionsError} when `requested` is not a positive integer.
 */
export function resolveConcurrency(requested: number | undefined, fallback: number): number {
  if (requested === undefined) return fallback;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new InvalidOptionsError(`concurrency must be a positive integer (got ${requested})`);
  }
  return requested;
}
