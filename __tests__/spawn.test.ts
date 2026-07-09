import { spawnFFmpeg } from '../src/core/spawn.js';
import { FFmpegError, FFmpegTimeoutError } from '../src/errors/index.js';
import type { Progress } from '../src/index.js';

// Use the running Node binary as a stand-in for ffmpeg/ffprobe.
const node = process.execPath;

describe('spawnFFmpeg', () => {
  it('resolves with the captured stdout', async () => {
    const out = await spawnFFmpeg({
      binary: node,
      args: ['-e', 'process.stdout.write("probe-json")'],
    });

    expect(out).toBe('probe-json');
  });

  it('rejects with FFmpegError carrying stderr and exit code', async () => {
    expect.assertions(3);
    try {
      await spawnFFmpeg({
        binary: node,
        args: ['-e', 'process.stderr.write("boom"); process.exit(3)'],
      });
    } catch (err) {
      expect(err).toBeInstanceOf(FFmpegError);
      expect((err as FFmpegError).exitCode).toBe(3);
      expect((err as FFmpegError).stderr).toContain('boom');
    }
  });

  it('rejects with FFmpegTimeoutError when the run exceeds the timeout', async () => {
    expect.assertions(2);
    try {
      await spawnFFmpeg({
        binary: node,
        args: ['-e', 'setTimeout(() => {}, 10_000)'],
        timeout: 50,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(FFmpegTimeoutError);
      expect((err as FFmpegTimeoutError).duration).toBe(50);
    }
  });

  it('rejects with an AbortError when aborted mid-run', async () => {
    expect.assertions(2);
    const controller = new AbortController();
    const promise = spawnFFmpeg({
      binary: node,
      args: ['-e', 'setTimeout(() => {}, 10_000)'],
      signal: controller.signal,
    });
    controller.abort();

    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(DOMException);
      expect((err as DOMException).name).toBe('AbortError');
    }
  });

  it('rejects immediately if the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      spawnFFmpeg({ binary: node, args: ['-e', ''], signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects with the underlying error when the binary cannot be spawned', async () => {
    await expect(spawnFFmpeg({ binary: '/no/such/binary-xyz', args: [] })).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('reports progress parsed from stderr time= lines', async () => {
    const percents: number[] = [];
    await spawnFFmpeg({
      binary: node,
      args: ['-e', 'process.stderr.write("frame=1 time=00:00:05.00 bitrate=64k")'],
      duration: 10,
      onProgress: (p) => percents.push(p.percent),
    });

    expect(percents).toEqual([50]);
  });

  it('reports enriched progress (fps, speed, bitrate, eta) from the stderr status line', async () => {
    const updates: Progress[] = [];
    await spawnFFmpeg({
      binary: node,
      args: [
        '-e',
        'process.stderr.write("fps= 30 time=00:00:05.00 bitrate= 800.0kbits/s speed=2.0x")',
      ],
      duration: 10,
      onProgress: (p) => updates.push(p),
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      percent: 50,
      currentTime: 5,
      fps: 30,
      speed: 2,
      bitrate: 800000,
      eta: 2.5,
    });
  });
});
