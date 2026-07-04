import { createWriteStream } from 'node:fs';

import { runStream } from '../src/index.js';
import { INPUT, ensureOutDir, out, log } from './_shared.js';

/**
 * The streaming escape hatch: data flows through FFmpeg's stdio without being
 * buffered in memory. A pipe is not seekable, so the output must use a
 * streamable container (here MPEG-TS). We read from a file and pipe stdout
 * (`pipe:1`) into a write stream.
 */
export default async function run(): Promise<void> {
  await ensureOutDir();

  const output = out('stream.ts');
  await runStream(['-i', INPUT, '-c', 'copy', '-f', 'mpegts', 'pipe:1'], {
    output: createWriteStream(output),
    duration: 10,
  });
  log(`wrote ${output}`);
}
