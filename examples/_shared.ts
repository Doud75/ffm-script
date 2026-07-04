import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '../src/index.js';
import type { Progress } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

/** The shared demo input: the repo's versioned 10s h264 + aac fixture. */
export const INPUT = join(here, '..', 'fixtures', 'sample.mp4');

/** Directory every example writes its output to (git-ignored). */
export const OUT = join(here, 'out');

/** Absolute path of a file inside the output directory. */
export function out(name: string): string {
  return join(OUT, name);
}

/** Create the output directory if it does not exist yet. */
export async function ensureOutDir(): Promise<void> {
  await mkdir(OUT, { recursive: true });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a throwaway watermark PNG (a translucent white box) with FFmpeg's
 * `lavfi` source, so the overlay example needs no committed binary asset. Also
 * a live demo of the raw `run()` escape hatch.
 */
export async function ensureWatermark(): Promise<string> {
  await ensureOutDir();
  const path = out('watermark.png');
  if (!(await exists(path))) {
    await run([
      '-f',
      'lavfi',
      '-i',
      'color=c=white@0.8:s=160x60,format=rgba',
      '-frames:v',
      '1',
      '-y',
      path,
    ]);
  }
  return path;
}

/** Write a tiny external `.srt` used by the subtitles burn-in example. */
export async function ensureSubtitles(): Promise<string> {
  await ensureOutDir();
  const path = out('sample.srt');
  const srt = [
    '1',
    '00:00:00,500 --> 00:00:03,000',
    'Burned in with ffm-script',
    '',
    '2',
    '00:00:03,500 --> 00:00:07,000',
    'from an external .srt file',
    '',
  ].join('\n');
  await writeFile(path, srt, 'utf8');
  return path;
}

/** A section header for readable console output. */
export function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

/** A single log line, indented under a section. */
export function log(message: string): void {
  console.log(`   ${message}`);
}

/** An `onProgress` callback that prints a percentage without flooding stdout. */
export function progressLogger(label: string): (p: Progress) => void {
  let last = -1;
  return (p: Progress) => {
    const pct = Math.floor(p.percent);
    if (pct >= last + 10) {
      last = pct;
      log(`${label}: ${pct}%`);
    }
  };
}
