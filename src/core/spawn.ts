import { spawn } from 'node:child_process';
import { FFmpegError, FFmpegTimeoutError } from '../errors/index.js';
import type { Progress } from '../types/index.js';

export interface SpawnOptions {
  /** Absolute path to the binary to run (resolved via `resolveBinary`). */
  binary: string;
  /** Arguments passed verbatim to the binary. */
  args: string[];
  /** Total media duration in seconds, used to compute the progress percentage. */
  duration?: number;
  /** Called whenever FFmpeg reports progress on stderr. */
  onProgress?: (progress: Progress) => void;
  /** Cancels the run; the promise rejects with an `AbortError` DOMException. */
  signal?: AbortSignal;
  /** Max run time in milliseconds; on overrun the process is killed and rejects with `FFmpegTimeoutError`. */
  timeout?: number;
}

// Matches FFmpeg progress lines, e.g. "time=00:01:23.45".
const TIME_RE = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/;

/**
 * Runs an FFmpeg/ffprobe process and resolves with its captured stdout.
 *
 * Responsibilities:
 * - captures stdout (returned) and stderr (used for progress and errors);
 * - rejects with {@link FFmpegError} on a non-zero exit code;
 * - rejects with {@link FFmpegTimeoutError} if `timeout` is exceeded;
 * - rejects with an `AbortError` DOMException when `signal` is aborted.
 */
export function spawnFFmpeg(options: SpawnOptions): Promise<string> {
  const { binary, args, duration, onProgress, signal, timeout } = options;

  return new Promise<string>((resolve, reject) => {
    // Bail out before spawning if cancellation was already requested.
    if (signal?.aborted === true) {
      reject(abortError());
      return;
    }

    const child = spawn(binary, args);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      action();
    };

    function onAbort(): void {
      child.kill('SIGTERM');
      settle(() => reject(abortError()));
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      reportProgress(text, duration, onProgress);
    });

    child.on('error', (err) => {
      settle(() => reject(err));
    });

    child.on('close', (code) => {
      if (code === 0) settle(() => resolve(stdout));
      else settle(() => reject(new FFmpegError(stderr, code ?? 1)));
    });

    if (timeout !== undefined) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        settle(() => reject(new FFmpegTimeoutError(timeout)));
      }, timeout);
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(): DOMException {
  return new DOMException('Operation aborted', 'AbortError');
}

function reportProgress(
  text: string,
  duration: number | undefined,
  onProgress: ((progress: Progress) => void) | undefined,
): void {
  if (onProgress === undefined || duration === undefined) return;

  const match = TIME_RE.exec(text);
  if (match === null) return;

  const [, hh, mm, ss, cs] = match;
  const currentTime =
    Number(hh ?? 0) * 3600 + Number(mm ?? 0) * 60 + Number(ss ?? 0) + Number(cs ?? 0) / 100;
  const percent = Math.min(100, (currentTime / duration) * 100);
  onProgress({ percent, currentTime, totalTime: duration });
}
