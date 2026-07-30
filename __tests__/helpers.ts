import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Committed test fixture: 10s, 1280x720 @ 30fps h264 video + 440Hz aac audio,
 * with a keyframe every second (`-g 30`). Generated via FFmpeg, see
 * `fixtures/sample.mp4`. Jest runs from the project root, so resolve from cwd.
 */
export const SAMPLE = join(process.cwd(), 'fixtures', 'sample.mp4');

/** Two cues covering the sample's first 9 seconds. */
export const SRT = `1
00:00:00,000 --> 00:00:04,000
Hello world

2
00:00:04,000 --> 00:00:09,000
Second cue
`;

/** Runs FFmpeg synchronously, quietly — for building test fixtures. */
function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
}

/**
 * Writes a solid-colour PNG to use as a watermark. 100x50 is enough to exercise
 * the overlay path without committing a binary asset.
 */
export function makeWatermark(dir: string, name = 'wm.png'): string {
  const path = join(dir, name);
  ffmpeg(['-f', 'lavfi', '-i', 'color=red:size=100x50', '-frames:v', '1', path]);
  return path;
}

/** Writes {@link SRT} to `dir` and returns its path. */
export function makeSrt(dir: string, name = 'subs.srt'): string {
  const path = join(dir, name);
  writeFileSync(path, SRT);
  return path;
}

/** Muxes `srt` into the sample as an embedded subtitle stream (MKV). */
export function makeMkvWithSubs(dir: string, srt: string, name = 'with-subs.mkv'): string {
  const path = join(dir, name);
  ffmpeg(['-i', SAMPLE, '-i', srt, '-map', '0', '-map', '1', '-c', 'copy', '-c:s', 'srt', path]);
  return path;
}
