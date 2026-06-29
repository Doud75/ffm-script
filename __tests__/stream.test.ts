import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStream } from '../src/operations/run.js';
import { probe } from '../src/operations/probe.js';
import { FFmpegError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

// FFmpeg can't seek a pipe, so the streamed format must be linearly readable:
// MPEG-TS for piped input, fragmented MP4 for piped output.
const FRAG_MP4 = ['-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'];

describe('runStream', () => {
  let dir: string;
  let tsSource: string; // streamable MPEG-TS copy of SAMPLE, for stdin tests

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-stream-'));
    tsSource = join(dir, 'source.ts');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', SAMPLE, '-c', 'copy', tsSource]);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('pipes stdout into a Writable (file → pipe → sink)', async () => {
    const output = join(dir, 'out-sink.mp4');
    await runStream(['-i', SAMPLE, '-c', 'copy', ...FRAG_MP4], {
      output: createWriteStream(output),
    });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.audio?.codec).toBe('aac');
    expect(info.duration).toBeCloseTo(10, 0);
  }, 30_000);

  it('pipes a Readable into stdin (source → pipe → file)', async () => {
    const output = join(dir, 'out-source.mp4');
    // Copying AAC out of MPEG-TS into MP4 needs the aac_adtstoasc bitstream
    // filter — the caller owns the args, so they supply it.
    await runStream(
      [
        '-i',
        'pipe:0',
        '-c',
        'copy',
        '-bsf:a',
        'aac_adtstoasc',
        '-movflags',
        'frag_keyframe+empty_moov',
        '-y',
        output,
      ],
      { input: createReadStream(tsSource) },
    );

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.duration).toBeCloseTo(10, 0);
  }, 30_000);

  it('streams pipe → pipe (Readable in, Writable out) with no buffering', async () => {
    const output = join(dir, 'out-both.mp4');
    await runStream(['-i', 'pipe:0', '-c', 'copy', '-bsf:a', 'aac_adtstoasc', ...FRAG_MP4], {
      input: createReadStream(tsSource),
      output: createWriteStream(output),
    });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.audio?.codec).toBe('aac');
  }, 30_000);

  it('reports progress when a duration is provided', async () => {
    const output = join(dir, 'out-progress.mp4');
    const percents: number[] = [];
    await runStream(['-i', SAMPLE, '-c', 'copy', ...FRAG_MP4], {
      output: createWriteStream(output),
      duration: 10,
      onProgress: (p) => percents.push(p.percent),
    });

    expect(percents.length).toBeGreaterThan(0);
    expect(Math.min(...percents)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
  }, 30_000);

  it('throws InvalidOptionsError when args is empty', async () => {
    await expect(runStream([])).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('rejects with FFmpegError when FFmpeg exits non-zero', async () => {
    const output = join(dir, 'out-bad.mp4');
    await expect(
      runStream(['-i', 'pipe:0', '-c', 'copy', '-f', 'definitelynotaformat', 'pipe:1'], {
        input: createReadStream(tsSource),
        output: createWriteStream(output),
      }),
    ).rejects.toBeInstanceOf(FFmpegError);
  }, 30_000);

  it('rejects with an AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runStream(['-i', SAMPLE, '-c', 'copy', ...FRAG_MP4], {
        output: createWriteStream(join(dir, 'out-aborted.mp4')),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
