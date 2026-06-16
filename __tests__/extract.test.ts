import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractAudio } from '../src/operations/extract.js';
import { FileNotFoundError, InvalidFormatError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  sample_rate?: string;
}

/** Probes any media file directly (probe() is MP4-only by design). */
function ffprobeStreams(file: string): ProbeStream[] {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', file],
    { encoding: 'utf8' },
  );
  return (JSON.parse(out) as { streams?: ProbeStream[] }).streams ?? [];
}

describe('extractAudio', () => {
  let dir: string;
  const input = SAMPLE;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-extract-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('extracts an MP3 track with no video stream', async () => {
    const output = join(dir, 'out.mp3');
    await extractAudio(input, output, { codec: 'mp3', bitrate: '192k' });

    const streams = ffprobeStreams(output);
    expect(streams.some((s) => s.codec_name === 'mp3')).toBe(true);
    expect(streams.some((s) => s.codec_type === 'video')).toBe(false);
  }, 30_000);

  it('extracts AAC and applies the requested sample rate', async () => {
    const output = join(dir, 'out.m4a');
    await extractAudio(input, output, { codec: 'aac', sampleRate: 22050 });

    const audio = ffprobeStreams(output).find((s) => s.codec_type === 'audio');
    expect(audio?.codec_name).toBe('aac');
    expect(audio?.sample_rate).toBe('22050');
  }, 30_000);

  it('infers the codec from the output extension', async () => {
    const output = join(dir, 'inferred.mp3');
    await extractAudio(input, output);

    const audio = ffprobeStreams(output).find((s) => s.codec_type === 'audio');
    expect(audio?.codec_name).toBe('mp3');
  }, 30_000);

  it('throws InvalidFormatError when extension and codec are incompatible', async () => {
    await expect(
      extractAudio(input, join(dir, 'bad.mp3'), { codec: 'aac' }),
    ).rejects.toBeInstanceOf(InvalidFormatError);
  });

  it('throws InvalidOptionsError when the codec cannot be inferred', async () => {
    await expect(extractAudio(input, join(dir, 'bad.ogg'))).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('throws FileNotFoundError when the input is missing', async () => {
    await expect(
      extractAudio(join(dir, 'nope.mp4'), join(dir, 'out.mp3')),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });
});
