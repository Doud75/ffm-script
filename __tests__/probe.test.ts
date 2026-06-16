import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probe } from '../src/operations/probe.js';
import { FileNotFoundError, InvalidFormatError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

describe('probe', () => {
  let dir: string;
  const sample = SAMPLE;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-probe-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads format-level metadata', async () => {
    const info = await probe(sample);
    expect(info.duration).toBeCloseTo(10, 0);
    expect(info.size).toBeGreaterThan(0);
    expect(info.bitrate).toBeGreaterThan(0);
    expect(info.streams).toHaveLength(2);
  });

  it('reads the primary video stream', async () => {
    const { video } = await probe(sample);
    expect(video).not.toBeNull();
    expect(video?.codec).toBe('h264');
    expect(video?.width).toBe(1280);
    expect(video?.height).toBe(720);
    expect(video?.fps).toBeCloseTo(30, 0);
    expect(video?.rotation).toBe(0);
  });

  it('reads the primary audio stream', async () => {
    const { audio } = await probe(sample);
    expect(audio).not.toBeNull();
    expect(audio?.codec).toBe('aac');
    expect(audio?.sampleRate).toBeGreaterThan(0);
    expect(audio?.channels).toBeGreaterThan(0);
  });

  it('throws FileNotFoundError for a missing file', async () => {
    await expect(probe(join(dir, 'nope.mp4'))).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('throws InvalidFormatError for a non-mp4 extension', async () => {
    const txt = join(dir, 'note.txt');
    writeFileSync(txt, 'hello');
    await expect(probe(txt)).rejects.toBeInstanceOf(InvalidFormatError);
  });
});
