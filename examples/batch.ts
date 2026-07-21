import { processBatch, convert, probe } from '../src/index.js';
import { INPUT, ensureOutDir, out, log } from './_shared.js';

/**
 * Batch processing: apply an operation across many files with a bounded pool.
 * Here the same input is transcoded to several widths at once — swap in a real
 * file list for your own use. `processBatch` is fail-fast and returns each task's
 * result in input order; here each `convert` resolves to void, so we probe after.
 */
export default async function run(): Promise<void> {
  await ensureOutDir();

  const widths = [320, 480, 640];
  const outputs = widths.map((w) => out(`batch_${w}.mp4`));

  await processBatch(
    widths,
    (width, i) => convert(INPUT, outputs[i]!, { quality: 'small', width }),
    {
      concurrency: 2, // at most 2 encodes in flight at a time
      onProgress: (done, total) => log(`batch: ${done}/${total} done`),
    },
  );

  for (const output of outputs) {
    const info = await probe(output);
    log(`wrote ${output} (${info.video?.width}x${info.video?.height})`);
  }
}
