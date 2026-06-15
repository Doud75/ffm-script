import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearBinaryCache, resolveBinary } from '../src/core/binary.js';
import { FFmpegNotFoundError } from '../src/errors/index.js';

const ENV_KEYS = ['PATH', 'FFMPEG_PATH', 'FFPROBE_PATH'] as const;

describe('resolveBinary', () => {
  let tmp: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    tmp = mkdtempSync(join(tmpdir(), 'ffm-bin-'));
    clearBinaryCache();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(tmp, { recursive: true, force: true });
    clearBinaryCache();
  });

  /** Creates an executable stub named `name` inside the temp dir. */
  function createExecutable(name: string): string {
    const path = join(tmp, name);
    writeFileSync(path, '#!/bin/sh\n');
    chmodSync(path, 0o755);
    return path;
  }

  it('returns the FFMPEG_PATH override when it is executable', () => {
    const bin = createExecutable('custom-ffmpeg');
    process.env['FFMPEG_PATH'] = bin;

    expect(resolveBinary('ffmpeg')).toBe(bin);
  });

  it('throws with the offending path when FFMPEG_PATH is set but invalid', () => {
    process.env['FFMPEG_PATH'] = join(tmp, 'missing');

    expect(() => resolveBinary('ffmpeg')).toThrow(FFmpegNotFoundError);
    expect(() => resolveBinary('ffmpeg')).toThrow(/missing/);
  });

  it('discovers ffprobe by scanning PATH', () => {
    delete process.env['FFPROBE_PATH'];
    const bin = createExecutable('ffprobe');
    process.env['PATH'] = tmp;

    expect(resolveBinary('ffprobe')).toBe(bin);
  });

  it('throws FFmpegNotFoundError when absent from PATH with no override', () => {
    delete process.env['FFMPEG_PATH'];
    process.env['PATH'] = tmp; // empty directory

    expect(() => resolveBinary('ffmpeg')).toThrow(FFmpegNotFoundError);
  });

  it('memoizes the resolved path across calls', () => {
    delete process.env['FFMPEG_PATH'];
    const bin = createExecutable('ffmpeg');
    process.env['PATH'] = tmp;

    const first = resolveBinary('ffmpeg');
    process.env['PATH'] = ''; // would fail to resolve if not cached

    expect(resolveBinary('ffmpeg')).toBe(first);
  });
});
