import { checkDependencies } from '../src/index.js';
import { section, log } from './_shared.js';

import probe from './probe.js';
import convert from './convert.js';
import progress from './progress.js';
import trim from './trim.js';
import extractAudio from './extract-audio.js';
import thumbnail from './thumbnail.js';
import overlay from './overlay.js';
import subtitles from './subtitles.js';
import animation from './animation.js';
import metadata from './metadata.js';
import concat from './concat.js';
import hls from './hls.js';
import chain from './chain.js';
import parallel from './parallel.js';
import runRaw from './run-raw.js';
import runStream from './run-stream.js';

interface Example {
  name: string;
  run: () => Promise<void>;
}

/** Every example, in the order they run. Names match the source file basenames. */
const examples: Example[] = [
  { name: 'probe', run: probe },
  { name: 'convert', run: convert },
  { name: 'progress', run: progress },
  { name: 'trim', run: trim },
  { name: 'extract-audio', run: extractAudio },
  { name: 'thumbnail', run: thumbnail },
  { name: 'overlay', run: overlay },
  { name: 'subtitles', run: subtitles },
  { name: 'animation', run: animation },
  { name: 'metadata', run: metadata },
  { name: 'concat', run: concat },
  { name: 'hls', run: hls },
  { name: 'chain', run: chain },
  { name: 'parallel', run: parallel },
  { name: 'run-raw', run: runRaw },
  { name: 'run-stream', run: runStream },
];

interface Result {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
}

async function main(): Promise<void> {
  await checkDependencies();

  const requested = process.argv.slice(2);
  let selected = examples;
  if (requested.length > 0) {
    const known = new Set(examples.map((e) => e.name));
    const unknown = requested.filter((name) => !known.has(name));
    if (unknown.length > 0) {
      console.error(`Unknown example(s): ${unknown.join(', ')}`);
      console.error(`Available: ${examples.map((e) => e.name).join(', ')}`);
      process.exitCode = 1;
      return;
    }
    selected = examples.filter((e) => requested.includes(e.name));
  }

  const results: Result[] = [];
  for (const example of selected) {
    section(example.name);
    const started = Date.now();
    try {
      await example.run();
      results.push({ name: example.name, ok: true, ms: Date.now() - started });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`FAILED: ${message}`);
      results.push({ name: example.name, ok: false, ms: Date.now() - started, error: message });
    }
  }

  section('summary');
  for (const result of results) {
    const status = result.ok ? 'OK  ' : 'FAIL';
    console.log(`   ${status} ${result.name.padEnd(14)} ${result.ms}ms`);
  }

  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) {
    console.log(`\n${failed} of ${results.length} example(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${results.length} example(s) passed.`);
  }
}

await main();
