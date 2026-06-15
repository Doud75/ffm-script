import { execSync } from 'node:child_process';
import { FFmpegNotFoundError } from '../errors/index.js';

export function resolveBinary(name: 'ffmpeg' | 'ffprobe'): string {
  const envVar = name === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH';
  const envPath = process.env[envVar];

  if (envPath) {
    return envPath;
  }

  const command = process.platform === 'win32' ? `where ${name}` : `which ${name}`;

  try {
    const output = execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const path = output.trim().split('\n')[0]?.trim();
    if (!path) throw new FFmpegNotFoundError(name);
    return path;
  } catch (err) {
    if (err instanceof FFmpegNotFoundError) throw err;
    throw new FFmpegNotFoundError(name);
  }
}

export function checkDependencies(): void {
  resolveBinary('ffmpeg');
  resolveBinary('ffprobe');
}
