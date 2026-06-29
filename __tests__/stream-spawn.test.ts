import { Readable, Writable } from 'node:stream';
import { spawnFFmpegStream } from '../src/core/spawn.js';
import { FFmpegError, FFmpegTimeoutError } from '../src/errors/index.js';

// The running Node binary stands in for ffmpeg, so the stream engine's
// error/abort/timeout paths can be exercised without FFmpeg.
const node = process.execPath;

/** A Writable that discards everything written to it. */
const sink = (): Writable => new Writable({ write: (_c, _e, cb) => cb() });

const aborted = (): AbortSignal => {
  const c = new AbortController();
  c.abort();
  return c.signal;
};

describe('spawnFFmpegStream', () => {
  it('resolves once the process exits 0 and the sink has flushed', async () => {
    await expect(
      spawnFFmpegStream({
        binary: node,
        args: ['-e', 'process.stdout.write("payload")'],
        output: sink(),
      }),
    ).resolves.toBeUndefined();
  });

  it('resolves with no output sink (stdout is drained)', async () => {
    await expect(
      spawnFFmpegStream({ binary: node, args: ['-e', 'process.stdout.write("x".repeat(5000))'] }),
    ).resolves.toBeUndefined();
  });

  it('pipes a Readable into stdin', async () => {
    await expect(
      spawnFFmpegStream({
        binary: node,
        args: ['-e', 'process.stdin.resume(); process.stdin.on("end", () => process.exit(0))'],
        input: Readable.from([Buffer.from('hello')]),
      }),
    ).resolves.toBeUndefined();
  });

  it('reports progress parsed from stderr', async () => {
    const percents: number[] = [];
    await spawnFFmpegStream({
      binary: node,
      args: ['-e', 'process.stderr.write("time=00:00:05.00")'],
      duration: 10,
      onProgress: (p) => percents.push(p.percent),
    });

    expect(percents).toEqual([50]);
  });

  it('rejects with FFmpegError on a non-zero exit', async () => {
    await expect(
      spawnFFmpegStream({
        binary: node,
        args: ['-e', 'process.stderr.write("boom"); process.exit(2)'],
        output: sink(),
      }),
    ).rejects.toBeInstanceOf(FFmpegError);
  });

  it('rejects when the binary cannot be spawned', async () => {
    await expect(
      spawnFFmpegStream({ binary: '/no/such/binary-xyz', args: [] }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects when the input stream errors', async () => {
    const input = new Readable({
      read() {
        this.destroy(new Error('input boom'));
      },
    });
    await expect(
      spawnFFmpegStream({ binary: node, args: ['-e', 'setTimeout(() => {}, 5000)'], input }),
    ).rejects.toThrow('input boom');
  });

  it('rejects when the output stream errors', async () => {
    const output = new Writable({ write: (_c, _e, cb) => cb(new Error('sink boom')) });
    await expect(
      spawnFFmpegStream({
        binary: node,
        args: ['-e', 'process.stdout.write("data")'],
        output,
      }),
    ).rejects.toThrow('sink boom');
  });

  it('rejects with AbortError when already aborted, tearing down the streams', async () => {
    await expect(
      spawnFFmpegStream({
        binary: node,
        args: ['-e', ''],
        input: Readable.from([Buffer.from('x')]),
        output: sink(),
        signal: aborted(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects with AbortError when aborted mid-run', async () => {
    const c = new AbortController();
    const promise = spawnFFmpegStream({
      binary: node,
      args: ['-e', 'setTimeout(() => {}, 5000)'],
      output: sink(),
      signal: c.signal,
    });
    c.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects with FFmpegTimeoutError when the run exceeds the timeout', async () => {
    await expect(
      spawnFFmpegStream({
        binary: node,
        args: ['-e', 'setTimeout(() => {}, 5000)'],
        output: sink(),
        timeout: 50,
      }),
    ).rejects.toBeInstanceOf(FFmpegTimeoutError);
  });

  it('swallows EPIPE on stdin when the process closes its input early', async () => {
    // The child never reads stdin and exits shortly after; the 1 MiB still being
    // piped in yields EPIPE on its stdin, which must be ignored (the real outcome
    // is the exit code, here 0 → resolve).
    await expect(
      spawnFFmpegStream({
        binary: node,
        args: ['-e', 'setTimeout(() => process.exit(0), 50)'],
        input: Readable.from([Buffer.alloc(1 << 20)]),
      }),
    ).resolves.toBeUndefined();
  });
});
