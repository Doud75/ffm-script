import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { FFmpegNotFoundError } from '../errors/index.js';

/** External binaries this library depends on. */
export type BinaryName = 'ffmpeg' | 'ffprobe';

/** Environment variable that overrides auto-detection for each binary. */
const ENV_OVERRIDE = {
  ffmpeg: 'FFMPEG_PATH',
  ffprobe: 'FFPROBE_PATH',
} as const satisfies Record<BinaryName, string>;

/** Extensions tried on Windows when PATHEXT is not set. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

const isWindows = process.platform === 'win32';

// A binary's location is stable for the lifetime of the process, so memoize it.
const cache = new Map<BinaryName, string>();

/** Returns true when `path` points to an existing, executable file. */
function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lazily yields every candidate absolute path for `name` across PATH entries.
 * On Windows each entry is expanded with the extensions listed in PATHEXT.
 */
function* candidatesInPath(name: string): Generator<string> {
  const extensions = isWindows ? (process.env.PATHEXT ?? DEFAULT_PATHEXT).split(';') : [''];

  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    for (const ext of extensions) {
      yield join(dir, name + ext);
    }
  }
}

/**
 * Resolves the absolute path to an FFmpeg binary.
 *
 * Lookup order:
 * 1. The matching environment override (`FFMPEG_PATH` / `FFPROBE_PATH`). If set
 *    but not executable, this is treated as a configuration error rather than
 *    falling back silently.
 * 2. The first executable match found while scanning `PATH`.
 *
 * The result is memoized for the lifetime of the process.
 *
 * @throws {FFmpegNotFoundError} when the binary cannot be located, with
 * per-platform installation instructions.
 */
export function resolveBinary(name: BinaryName): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const resolved = resolveFromEnv(name) ?? resolveFromPath(name);
  if (resolved === undefined) {
    throw new FFmpegNotFoundError(name);
  }

  cache.set(name, resolved);
  return resolved;
}

function resolveFromEnv(name: BinaryName): string | undefined {
  const override = process.env[ENV_OVERRIDE[name]];
  if (override === undefined || override === '') return undefined;
  if (!isExecutable(override)) {
    throw new FFmpegNotFoundError(name, override);
  }
  return override;
}

function resolveFromPath(name: BinaryName): string | undefined {
  for (const candidate of candidatesInPath(name)) {
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
}

/** Clears the resolution cache. Primarily useful for tests. */
export function clearBinaryCache(): void {
  cache.clear();
}

/**
 * Eagerly resolves both required binaries, throwing if either is missing.
 * Call once at startup to fail fast with a clear, actionable message.
 *
 * @throws {FFmpegNotFoundError}
 */
export function checkDependencies(): void {
  resolveBinary('ffmpeg');
  resolveBinary('ffprobe');
}
