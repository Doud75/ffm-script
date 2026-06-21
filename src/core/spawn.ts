import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
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

export interface StreamSpawnOptions {
  /** Absolute path to the binary to run (resolved via `resolveBinary`). */
  binary: string;
  /** Arguments passed verbatim to the binary (use `pipe:0`/`pipe:1` for the piped ends). */
  args: string[];
  /** Piped into the process's stdin. The args must read it (`-i pipe:0`). */
  input?: Readable;
  /** The process's stdout is piped here. The args must write to it (`pipe:1`). */
  output?: Writable;
  /** Total media duration in seconds, used to compute the progress percentage. */
  duration?: number;
  /** Called whenever FFmpeg reports progress on stderr. */
  onProgress?: (progress: Progress) => void;
  /** Cancels the run; the promise rejects with an `AbortError` DOMException. */
  signal?: AbortSignal;
  /** Max run time in milliseconds; on overrun the process is killed and rejects with `FFmpegTimeoutError`. */
  timeout?: number;
}

/**
 * Runs an FFmpeg process wired to Node streams, **without buffering stdout** —
 * the data flows straight from `input` through FFmpeg to `output`, keeping the
 * memory footprint bounded regardless of file size.
 *
 * Same guarantees as {@link spawnFFmpeg} (progress, abort, timeout, typed
 * errors), but resolves with `void`: the bytes go to `output`, not the promise.
 * Resolves once the process exits 0 **and** `output` has flushed; rejects with
 * {@link FFmpegError} on a non-zero exit, or with the underlying error if a
 * stream fails.
 */
export function spawnFFmpegStream(options: StreamSpawnOptions): Promise<void> {
  const { binary, args, input, output, duration, onProgress, signal, timeout } = options;

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      // Nothing ran, so tear down the caller's streams. Swallow their teardown
      // errors (e.g. a sink whose lazy open later fails): the promise already
      // rejects with AbortError, so that noise must not crash the process.
      input?.on('error', noop).destroy();
      output?.on('error', noop).destroy();
      reject(abortError());
      return;
    }

    const child = spawn(binary, args);
    let stderr = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    let exited = false;
    let exitCode: number | null = null;
    // Nothing to flush when there is no output sink.
    let outputFlushed = output === undefined;

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      input?.destroy();
      output?.destroy();
      child.kill('SIGKILL');
      reject(err);
    };

    // Resolves only once the process has exited cleanly and the sink has drained.
    const maybeResolve = (): void => {
      if (settled || !exited) return;
      if (exitCode !== 0) {
        settled = true;
        cleanup();
        input?.destroy();
        output?.destroy();
        reject(new FFmpegError(stderr, exitCode ?? 1));
        return;
      }
      if (!outputFlushed) return;
      settled = true;
      cleanup();
      resolve();
    };

    function onAbort(): void {
      if (settled) return;
      settled = true;
      cleanup();
      input?.destroy();
      output?.destroy();
      child.kill('SIGTERM');
      reject(abortError());
    }

    if (input !== undefined) {
      input.on('error', fail);
      // FFmpeg may close stdin early (e.g. it has read enough); the resulting
      // EPIPE is expected — the real outcome is the process exit code.
      child.stdin.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EPIPE') return;
        fail(err);
      });
      input.pipe(child.stdin);
    }

    if (output !== undefined) {
      output.on('error', fail);
      output.on('finish', () => {
        outputFlushed = true;
        maybeResolve();
      });
      child.stdout.pipe(output);
    } else {
      // Drain stdout so backpressure never stalls FFmpeg when no sink is attached.
      child.stdout.resume();
    }

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      reportProgress(text, duration, onProgress);
    });

    child.on('error', fail);

    child.on('close', (code) => {
      exited = true;
      exitCode = code;
      maybeResolve();
    });

    if (timeout !== undefined) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        input?.destroy();
        output?.destroy();
        child.kill('SIGKILL');
        reject(new FFmpegTimeoutError(timeout));
      }, timeout);
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function noop(): void {
  /* swallow */
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
