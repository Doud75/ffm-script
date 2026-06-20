import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setMetadata } from '../src/operations/metadata.js';
import { buildMetadataArgs } from '../src/core/metadata.js';
import { probe } from '../src/operations/probe.js';
import { FileNotFoundError, InvalidFormatError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

describe('buildMetadataArgs', () => {
  it('emits one -metadata key=value per tag', () => {
    expect(buildMetadataArgs({ tags: { title: 'My Movie', artist: 'Me' }, clear: false })).toEqual([
      '-metadata', 'title=My Movie',
      '-metadata', 'artist=Me',
    ]);
  });

  it('prepends -map_metadata -1 when clearing, before the new tags', () => {
    expect(buildMetadataArgs({ tags: { title: 'X' }, clear: true })).toEqual([
      '-map_metadata', '-1',
      '-metadata', 'title=X',
    ]);
  });

  it('returns only the clear flag when there are no tags', () => {
    expect(buildMetadataArgs({ tags: {}, clear: true })).toEqual(['-map_metadata', '-1']);
  });

  it('returns nothing when there is no tag and no clear', () => {
    expect(buildMetadataArgs({ tags: {}, clear: false })).toEqual([]);
  });

  it('keeps spaces and = in values without escaping', () => {
    expect(buildMetadataArgs({ tags: { comment: 'a = b c' }, clear: false })).toEqual([
      '-metadata', 'comment=a = b c',
    ]);
  });
});

describe('setMetadata', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-metadata-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes tags that probe reads back, without re-encoding', async () => {
    const output = join(dir, 'tagged.mp4');
    await setMetadata(SAMPLE, output, {
      tags: { title: 'My Movie', artist: 'ffm-script', comment: 'hello world' },
    });

    const info = await probe(output);
    expect(info.tags.title).toBe('My Movie');
    expect(info.tags.artist).toBe('ffm-script');
    expect(info.tags.comment).toBe('hello world');
    // streams copied through untouched
    expect(info.video?.codec).toBe('h264');
    expect(info.audio?.codec).toBe('aac');
    expect(info.duration).toBeCloseTo(10, 0);
  }, 60_000);

  it('strips all metadata with clear and no tags', async () => {
    const tagged = join(dir, 'to-strip.mp4');
    await setMetadata(SAMPLE, tagged, { tags: { title: 'Temp', artist: 'Temp' } });
    expect((await probe(tagged)).tags.title).toBe('Temp');

    const stripped = join(dir, 'stripped.mp4');
    await setMetadata(tagged, stripped, { clear: true });

    const info = await probe(stripped);
    expect(info.tags.title).toBeUndefined();
    expect(info.tags.artist).toBeUndefined();
  }, 60_000);

  it('clear keeps only the freshly set tags', async () => {
    const tagged = join(dir, 'old-tags.mp4');
    await setMetadata(SAMPLE, tagged, { tags: { title: 'Old', artist: 'Old' } });

    const output = join(dir, 'replaced.mp4');
    await setMetadata(tagged, output, { tags: { title: 'New' }, clear: true });

    const info = await probe(output);
    expect(info.tags.title).toBe('New');
    expect(info.tags.artist).toBeUndefined();
  }, 60_000);

  it('works on an audio-only file (no video stream)', async () => {
    const input = join(dir, 'audio-in.mp3');
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', input,
    ]);

    const output = join(dir, 'audio-out.mp3');
    await setMetadata(input, output, { tags: { title: 'My Song', artist: 'Me' } });

    const info = await probe(output);
    expect(info.video).toBeNull();
    expect(info.audio?.codec).toBe('mp3'); // audio copied through
    expect(info.tags.title).toBe('My Song');
    expect(info.tags.artist).toBe('Me');
  }, 60_000);

  it('throws InvalidOptionsError when neither tags nor clear is given', async () => {
    await expect(setMetadata(SAMPLE, join(dir, 'noop.mp4'), {})).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('throws InvalidOptionsError for a key containing "="', async () => {
    await expect(
      setMetadata(SAMPLE, join(dir, 'bad.mp4'), { tags: { 'a=b': 'x' } }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('throws InvalidFormatError when the output extension is unsupported', async () => {
    await expect(
      setMetadata(SAMPLE, join(dir, 'out.txt'), { tags: { title: 'X' } }),
    ).rejects.toBeInstanceOf(InvalidFormatError);
  });

  it('throws FileNotFoundError when the input is missing', async () => {
    await expect(
      setMetadata(join(dir, 'nope.mp4'), join(dir, 'out.mp4'), { tags: { title: 'X' } }),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });
});
