import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { thumbnail } from '../src/operations/thumbnail.js';
import { FileNotFoundError, InvalidFormatError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

interface ImageStream {
  codec_name?: string;
  width?: number;
  height?: number;
}

/** Returns the first stream of an image file via ffprobe. */
function imageStream(file: string): ImageStream {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', file],
    { encoding: 'utf8' },
  );
  const streams = (JSON.parse(out) as { streams?: ImageStream[] }).streams ?? [];
  return streams[0] ?? {};
}

describe('thumbnail', () => {
  let dir: string;
  const input = SAMPLE;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-thumb-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('captures a JPEG frame', async () => {
    const output = join(dir, 'frame.jpg');
    await thumbnail(input, output, { timestamp: 1 });

    expect(existsSync(output)).toBe(true);
    expect(statSync(output).size).toBeGreaterThan(0);
    expect(imageStream(output).codec_name).toBe('mjpeg');
  }, 30_000);

  it('captures a PNG and resizes to the requested width', async () => {
    const output = join(dir, 'frame.png');
    await thumbnail(input, output, { timestamp: '00:00:02', width: 320 });

    const stream = imageStream(output);
    expect(stream.codec_name).toBe('png');
    expect(stream.width).toBe(320);
    expect(stream.height).toBe(180); // 16:9 preserved
  }, 30_000);

  it('throws InvalidFormatError for an unsupported output extension', async () => {
    await expect(
      thumbnail(input, join(dir, 'frame.gif'), { timestamp: 1 }),
    ).rejects.toBeInstanceOf(InvalidFormatError);
  });

  it('throws InvalidOptionsError for a bad timestamp', async () => {
    await expect(
      thumbnail(input, join(dir, 'frame.jpg'), { timestamp: 'xyz' }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('throws InvalidOptionsError for a non-positive width', async () => {
    await expect(
      thumbnail(input, join(dir, 'frame.jpg'), { timestamp: 1, width: 0 }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('throws FileNotFoundError when the input is missing', async () => {
    await expect(
      thumbnail(join(dir, 'nope.mp4'), join(dir, 'frame.jpg'), { timestamp: 1 }),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });
});
