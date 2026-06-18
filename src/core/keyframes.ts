import { extname } from 'node:path';
import { resolveBinary } from './binary.js';
import { spawnFFmpeg } from './spawn.js';
import { extractKeyframeIndex } from './mp4.js';
import { InvalidFormatError } from '../errors/index.js';
import type { Keyframe } from '../types/index.js';

/** Containers whose keyframe index can be read straight from the ISOBMFF `stss` box. */
const ISOBMFF_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v']);

/**
 * Returns the video keyframe index for a media file, picking the cheapest method
 * for the container:
 *
 * - ISOBMFF (`.mp4`, `.mov`, `.m4v`): parse the `stss` box directly — no FFmpeg.
 * - Anything else (`.mkv`, `.webm`): ask ffprobe for keyframe packet timestamps.
 *
 * ISOBMFF files the binary parser cannot handle (e.g. fragmented or unusual
 * layouts) fall back to ffprobe rather than failing.
 *
 * @throws {InvalidFormatError} when no video keyframes can be found.
 */
export async function resolveKeyframes(input: string): Promise<Keyframe[]> {
  if (ISOBMFF_EXTENSIONS.has(extname(input).toLowerCase())) {
    try {
      return await extractKeyframeIndex(input);
    } catch (err) {
      if (!(err instanceof InvalidFormatError)) throw err;
      // Unparseable ISOBMFF — re-index via ffprobe instead of giving up.
    }
  }
  return probeKeyframes(input);
}

/**
 * Lists keyframe timestamps via ffprobe by reading the video packet flags — the
 * `K` flag marks a keyframe. Reads packets only (no decoding), so it stays fast
 * and works across every container ffprobe understands.
 *
 * @throws {InvalidFormatError} when the stream exposes no keyframe.
 */
export async function probeKeyframes(input: string): Promise<Keyframe[]> {
  const stdout = await spawnFFmpeg({
    binary: resolveBinary('ffprobe'),
    args: [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'packet=pts_time,flags',
      '-of',
      'csv=print_section=0',
      input,
    ],
  });

  // Each line is "<pts_time>,<flags>", e.g. "1.023000,K__".
  const times: number[] = [];
  for (const line of stdout.split('\n')) {
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    if (!line.includes('K', comma + 1)) continue; // not a keyframe packet
    const time = Number(line.slice(0, comma));
    if (Number.isFinite(time)) times.push(time);
  }

  if (times.length === 0) {
    throw new InvalidFormatError(input, 'no video keyframes found');
  }

  times.sort((a, b) => a - b);
  // Anchor the first segment to the very start: some containers report the first
  // video keyframe at a small positive offset (the container start time).
  if (times[0]! > 0) times[0] = 0;

  return times.map((timestamp) => ({ timestamp }));
}
