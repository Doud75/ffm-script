import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractSubtitles, burnSubtitles } from '../src/operations/subtitles.js';
import { escapeSubtitlesPath, buildSubtitlesFilter } from '../src/core/subtitles.js';
import { probe } from '../src/operations/probe.js';
import { FileNotFoundError, InvalidFormatError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

const SRT = `1
00:00:00,000 --> 00:00:04,000
Hello world

2
00:00:04,000 --> 00:00:09,000
Second cue
`;

describe('escapeSubtitlesPath', () => {
  it("escapes the filtergraph metacharacters \\ : and '", () => {
    expect(escapeSubtitlesPath('/tmp/a/subs.srt')).toBe('/tmp/a/subs.srt'); // nothing to escape
    expect(escapeSubtitlesPath("C:\\subs's.srt")).toBe("C\\:\\\\subs\\'s.srt");
  });
});

describe('buildSubtitlesFilter', () => {
  it('renders an external file without a stream index', () => {
    expect(buildSubtitlesFilter('/tmp/subs.srt')).toBe('subtitles=/tmp/subs.srt');
  });

  it('selects an embedded track via si=', () => {
    expect(buildSubtitlesFilter('/tmp/in.mkv', 1)).toBe('subtitles=/tmp/in.mkv:si=1');
  });
});

describe('subtitles operations', () => {
  let dir: string;
  let srt: string;
  let withSubs: string; // MKV carrying an embedded subtitle track

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-subs-'));
    srt = join(dir, 'subs.srt');
    writeFileSync(srt, SRT);
    withSubs = join(dir, 'with-subs.mkv');
    // Mux the SRT into the sample as an embedded subtitle stream.
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      SAMPLE,
      '-i',
      srt,
      '-map',
      '0',
      '-map',
      '1',
      '-c',
      'copy',
      '-c:s',
      'srt',
      withSubs,
    ]);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('extractSubtitles', () => {
    it('extracts an embedded track to an .srt file', async () => {
      const out = join(dir, 'out.srt');
      await extractSubtitles(withSubs, out);

      const content = readFileSync(out, 'utf8');
      expect(content).toContain('Hello world');
      expect(content).toContain('Second cue');
    }, 30_000);

    it('converts the track to WebVTT from the output extension', async () => {
      const out = join(dir, 'out.vtt');
      await extractSubtitles(withSubs, out);

      const content = readFileSync(out, 'utf8');
      expect(content).toMatch(/^WEBVTT/); // converted, not raw SubRip
      expect(content).toContain('Hello world');
    }, 30_000);

    it('throws InvalidFormatError when the input has no subtitle track', async () => {
      await expect(extractSubtitles(SAMPLE, join(dir, 'x.srt'))).rejects.toBeInstanceOf(
        InvalidFormatError,
      );
    }, 30_000);

    it('throws InvalidOptionsError when the track is out of range', async () => {
      await expect(
        extractSubtitles(withSubs, join(dir, 'x.srt'), { track: 5 }),
      ).rejects.toBeInstanceOf(InvalidOptionsError);
    }, 30_000);

    it('throws InvalidFormatError for an unsupported output extension', async () => {
      await expect(extractSubtitles(withSubs, join(dir, 'x.txt'))).rejects.toBeInstanceOf(
        InvalidFormatError,
      );
    });
  });

  describe('burnSubtitles', () => {
    it('burns an external subtitle file, keeping duration and audio', async () => {
      const out = join(dir, 'burn-ext.mp4');
      const percents: number[] = [];
      await burnSubtitles(SAMPLE, out, {
        subtitles: srt,
        onProgress: (p) => percents.push(p.percent),
      });

      const info = await probe(out);
      expect(info.video?.codec).toBe('h264');
      expect(info.audio?.codec).toBe('aac'); // audio copied through
      expect(info.duration).toBeCloseTo(10, 0);
      // Burned in, so the output carries no subtitle stream of its own.
      expect(info.streams.some((s) => s.type === 'subtitle')).toBe(false);
      expect(percents.length).toBeGreaterThan(0);
      expect(Math.max(...percents)).toBeLessThanOrEqual(100);
    }, 60_000);

    it('burns an embedded track from the input', async () => {
      const out = join(dir, 'burn-embedded.mp4');
      await burnSubtitles(withSubs, out, { track: 0 });

      const info = await probe(out);
      expect(info.video?.codec).toBe('h264');
      expect(info.duration).toBeCloseTo(10, 0);
      expect(info.streams.some((s) => s.type === 'subtitle')).toBe(false);
    }, 60_000);

    it('throws InvalidFormatError when no embedded track and no external file', async () => {
      await expect(burnSubtitles(SAMPLE, join(dir, 'x.mp4'))).rejects.toBeInstanceOf(
        InvalidFormatError,
      );
    }, 30_000);

    it('throws InvalidFormatError when the output is not an .mp4', async () => {
      await expect(
        burnSubtitles(SAMPLE, join(dir, 'x.mkv'), { subtitles: srt }),
      ).rejects.toBeInstanceOf(InvalidFormatError);
    });

    it('throws FileNotFoundError when the external subtitle file is missing', async () => {
      await expect(
        burnSubtitles(SAMPLE, join(dir, 'x.mp4'), { subtitles: join(dir, 'nope.srt') }),
      ).rejects.toBeInstanceOf(FileNotFoundError);
    });
  });
});
