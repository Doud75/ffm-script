import { resolveBinary } from './binary.js';
import { spawnFFmpeg } from './spawn.js';
import { InvalidOptionsError } from '../errors/index.js';

/**
 * Builds the hardware-decoding flag for an input.
 *
 * These are **input** options: FFmpeg applies them to the file that follows, so
 * the caller must push them before its `-i`. The value is passed through
 * untouched — availability depends on the FFmpeg build and the host, and a name
 * FFmpeg doesn't know produces a clear error of its own, so validating here
 * would only risk rejecting a method that actually works.
 *
 * @param hwaccel - Method name (`'cuda'`, `'videotoolbox'`, `'qsv'`, …), or
 * `'none'` for explicit software decoding. See {@link listHwaccels}.
 * @throws {InvalidOptionsError} when set to an empty or blank string.
 */
export function buildHwaccelArgs(hwaccel: string | undefined): string[] {
  if (hwaccel === undefined) return [];
  if (hwaccel.trim() === '') {
    throw new InvalidOptionsError('hwaccel must be a non-empty method name (e.g. "cuda", "none")');
  }
  return ['-hwaccel', hwaccel];
}

/**
 * Parses the output of `ffmpeg -hwaccels`, which prints a header line followed
 * by one method per line:
 *
 * ```
 * Hardware acceleration methods:
 * videotoolbox
 * ```
 */
export function parseHwaccels(stdout: string): string[] {
  return stdout
    .split('\n')
    .slice(1) // drop the "Hardware acceleration methods:" header
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

// The available methods are a property of the FFmpeg build and the host, neither
// of which changes while the process runs — so ask once and reuse the answer.
let cached: Promise<string[]> | undefined;

/**
 * Lists the hardware acceleration methods this FFmpeg build supports, for use as
 * the `hwaccel` option of {@link convert} or {@link parallelConvert}.
 *
 * Being listed means FFmpeg was *compiled* with the method — not that this
 * machine can run it (a `cuda` build without an NVIDIA GPU still lists `cuda`).
 * Treat it as a filter for picking a candidate, and keep a software fallback.
 *
 * The result is memoized for the lifetime of the process.
 *
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 *
 * @example
 * const accels = await listHwaccels()
 * const hwaccel = accels.includes('cuda') ? 'cuda' : undefined
 * await convert('in.mp4', 'out.mp4', { ...(hwaccel !== undefined && { hwaccel }) })
 */
export function listHwaccels(): Promise<string[]> {
  // Don't cache a failure: a missing binary that gets installed, or a transient
  // error, shouldn't poison every later call.
  cached ??= fetchHwaccels().catch((err: unknown) => {
    cached = undefined;
    throw err;
  });
  return cached;
}

// Async so that a failure to even resolve the binary comes back as a rejected
// promise like every other error, rather than throwing synchronously out of
// `listHwaccels` and bypassing the caller's `.catch`.
async function fetchHwaccels(): Promise<string[]> {
  const stdout = await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args: ['-hide_banner', '-hwaccels'],
  });
  return parseHwaccels(stdout);
}

/** Clears the memoized method list. Primarily useful for tests. */
export function clearHwaccelCache(): void {
  cached = undefined;
}
