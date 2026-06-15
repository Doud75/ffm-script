import { spawn } from 'node:child_process';
import { FFmpegError } from '../errors/index.js';
import type { Progress } from '../types/index.js';

export interface SpawnOptions {
  args: string[];
  binary: string;
  duration?: number;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
}

const TIME_RE = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/;

export function spawnFFmpeg(options: SpawnOptions): Promise<void> {
  const { args, binary, duration, onProgress, signal } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args);
    let stderrOutput = '';
    let settled = false;

    const settle = (fn: () => void): void => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrOutput += text;

      if (onProgress !== undefined && duration !== undefined) {
        const match = TIME_RE.exec(text);
        if (match !== null) {
          const [, hh, mm, ss, cs] = match;
          const currentTime =
            parseInt(hh ?? '0', 10) * 3600 +
            parseInt(mm ?? '0', 10) * 60 +
            parseInt(ss ?? '0', 10) +
            parseInt(cs ?? '0', 10) / 100;
          const percent = Math.min(100, (currentTime / duration) * 100);
          onProgress({ percent, currentTime, totalTime: duration });
        }
      }
    });

    child.on('close', (code) => {
      if (code !== 0) {
        settle(() => reject(new FFmpegError(stderrOutput, code ?? 1)));
      } else {
        settle(() => resolve());
      }
    });

    child.on('error', (err) => {
      settle(() => reject(err));
    });

    if (signal !== undefined) {
      signal.addEventListener(
        'abort',
        () => {
          child.kill('SIGTERM');
          settle(() => reject(new Error('Operation cancelled')));
        },
        { once: true },
      );
    }
  });
}
