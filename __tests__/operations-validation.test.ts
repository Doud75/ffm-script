import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { thumbnail } from '../src/operations/thumbnail.js';
import { extractAudio } from '../src/operations/extract.js';
import { trim } from '../src/operations/trim.js';
import { convert } from '../src/operations/convert.js';
import { toAnimation } from '../src/operations/animation.js';
import { toHLS } from '../src/operations/hls.js';
import { overlay } from '../src/operations/overlay.js';
import { setMetadata } from '../src/operations/metadata.js';
import { extractSubtitles, burnSubtitles } from '../src/operations/subtitles.js';
import { concat } from '../src/operations/concat.js';
import { run, runStream } from '../src/operations/run.js';
import { ffmscript } from '../src/operations/chain.js';
import { InvalidFormatError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

// These tests drive the *non-FFmpeg* code paths: input validation and option
// handling. Where a spread only fires once the engine is reached, an
// already-aborted signal lets us cover it — spawn rejects before launching
// FFmpeg, so the option object (bitrates, progress, signal…) is still built.
const aborted = (): AbortSignal => {
  const c = new AbortController();
  c.abort();
  return c.signal;
};
const noop = (): void => {};
const isAbort = { name: 'AbortError' };

let dir: string;
let watermark: string;
let subtitle: string;
const out = (name: string): string => join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ffm-opval-'));
  // validateInput only checks existence + extension, so empty stand-ins suffice.
  watermark = join(dir, 'wm.png');
  subtitle = join(dir, 'subs.srt');
  writeFileSync(watermark, '');
  writeFileSync(subtitle, '');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('thumbnail validation', () => {
  it('rejects a negative timestamp', async () => {
    await expect(thumbnail(SAMPLE, out('t.jpg'), { timestamp: -1 })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('rejects an output with no image extension', async () => {
    await expect(thumbnail(SAMPLE, out('noext'), { timestamp: 0 })).rejects.toThrow(/\(none\)/);
  });

  it('builds the resize args and threads the signal', async () => {
    await expect(
      thumbnail(SAMPLE, out('t.png'), { timestamp: 0, width: 100, signal: aborted() }),
    ).rejects.toMatchObject(isAbort);
  });
});

describe('extractAudio validation', () => {
  it('rejects when the codec cannot be inferred from the extension', async () => {
    await expect(extractAudio(SAMPLE, out('a.wav'))).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('rejects an extension incompatible with the chosen codec', async () => {
    await expect(extractAudio(SAMPLE, out('a.aac'), { codec: 'mp3' })).rejects.toBeInstanceOf(
      InvalidFormatError,
    );
  });

  it('reports "(none)" when an extensionless output is incompatible with the codec', async () => {
    await expect(extractAudio(SAMPLE, out('noext'), { codec: 'mp3' })).rejects.toThrow(/\(none\)/);
  });

  it('reports "(no extension)" when inference has no extension to work with', async () => {
    await expect(extractAudio(SAMPLE, out('noext'))).rejects.toThrow(/no extension/);
  });

  it('builds bitrate/sampleRate args and threads the signal', async () => {
    await expect(
      extractAudio(SAMPLE, out('a.mp3'), {
        bitrate: '192k',
        sampleRate: 44100,
        signal: aborted(),
      }),
    ).rejects.toMatchObject(isAbort);
  });
});

describe('trim validation', () => {
  it('rejects a negative start', async () => {
    await expect(trim(SAMPLE, out('tr.mp4'), { start: -1, end: 5 })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('threads progress and signal (precise mode)', async () => {
    await expect(
      trim(SAMPLE, out('tr.mp4'), {
        start: 0,
        end: 2,
        mode: 'precise',
        onProgress: noop,
        signal: aborted(),
      }),
    ).rejects.toMatchObject(isAbort);
  });
});

describe('convert option args', () => {
  it('builds bitrate args, probes for progress, and threads the signal', async () => {
    await expect(
      convert(SAMPLE, out('c.mp4'), {
        videoBitrate: '1M',
        audioBitrate: '128k',
        onProgress: noop,
        signal: aborted(),
      }),
    ).rejects.toMatchObject(isAbort);
  });
});

describe('toAnimation validation', () => {
  it('rejects a non-positive width', async () => {
    await expect(toAnimation(SAMPLE, out('a.gif'), { width: 0 })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('rejects a non-integer loop', async () => {
    await expect(toAnimation(SAMPLE, out('a.gif'), { loop: 1.5 })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('rejects a negative start', async () => {
    await expect(toAnimation(SAMPLE, out('a.gif'), { start: -1 })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('probes for an open-ended clip when progress is requested, then threads the signal', async () => {
    await expect(
      toAnimation(SAMPLE, out('a.gif'), { onProgress: noop, signal: aborted() }),
    ).rejects.toMatchObject(isAbort);
  });
});

describe('toHLS validation', () => {
  it('rejects a non-positive resolution width', async () => {
    await expect(
      toHLS(SAMPLE, out('hls-bad'), { resolutions: [{ width: 0, bitrate: '1M' }] }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('probes, creates the dir, and threads progress/signal', async () => {
    await expect(
      toHLS(SAMPLE, out('hls'), {
        resolutions: [{ width: 320, bitrate: '500k' }],
        onProgress: noop,
        signal: aborted(),
      }),
    ).rejects.toMatchObject(isAbort);
  });
});

describe('overlay validation', () => {
  it('rejects a negative margin', async () => {
    await expect(overlay(SAMPLE, out('o.mp4'), { watermark, margin: -1 })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('rejects a non-positive width', async () => {
    await expect(overlay(SAMPLE, out('o.mp4'), { watermark, width: 0 })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('probes for progress and threads the signal', async () => {
    await expect(
      overlay(SAMPLE, out('o.mp4'), { watermark, onProgress: noop, signal: aborted() }),
    ).rejects.toMatchObject(isAbort);
  });
});

describe('setMetadata validation', () => {
  it('rejects an output with no extension', async () => {
    await expect(setMetadata(SAMPLE, out('noext'), { tags: { title: 'x' } })).rejects.toThrow(
      /missing file extension/,
    );
  });

  it('rejects when neither tags nor clear is given (default options)', async () => {
    await expect(setMetadata(SAMPLE, out('m.mp4'))).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('threads the signal', async () => {
    await expect(
      setMetadata(SAMPLE, out('m.mp4'), { tags: { title: 'x' }, signal: aborted() }),
    ).rejects.toMatchObject(isAbort);
  });
});

describe('subtitles validation', () => {
  it('rejects an unsupported subtitle extension', async () => {
    await expect(extractSubtitles(SAMPLE, out('s.txt'))).rejects.toThrow(/unsupported subtitle/);
  });

  it('rejects a negative track', async () => {
    await expect(extractSubtitles(SAMPLE, out('s.srt'), { track: -1 })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('burns an external subtitle file, probing for progress and threading the signal', async () => {
    await expect(
      burnSubtitles(SAMPLE, out('b.mp4'), {
        subtitles: subtitle,
        onProgress: noop,
        signal: aborted(),
      }),
    ).rejects.toMatchObject(isAbort);
  });
});

describe('concat option paths', () => {
  it('threads progress/signal through the fast (demuxer) path', async () => {
    await expect(
      concat([SAMPLE, SAMPLE], out('cat.mp4'), {
        mode: 'fast',
        onProgress: noop,
        signal: aborted(),
      }),
    ).rejects.toMatchObject(isAbort);
  });

  it('threads progress/signal through the precise (filter) path', async () => {
    await expect(
      concat([SAMPLE, SAMPLE], out('cat.mp4'), {
        mode: 'precise',
        onProgress: noop,
        signal: aborted(),
      }),
    ).rejects.toMatchObject(isAbort);
  });
});

describe('run option spreads', () => {
  it('threads duration/progress/timeout/signal', async () => {
    await expect(
      run(['-i', SAMPLE, '-y', out('r.mp4')], {
        duration: 10,
        onProgress: noop,
        timeout: 1000,
        signal: aborted(),
      }),
    ).rejects.toMatchObject(isAbort);
  });

  it('threads input/output/duration/progress/timeout/signal in runStream', async () => {
    await expect(
      runStream(['-i', 'pipe:0', '-c', 'copy', '-f', 'mpegts', 'pipe:1'], {
        input: Readable.from([Buffer.from('x')]),
        output: new Writable({ write: (_c, _e, cb) => cb() }),
        duration: 10,
        onProgress: noop,
        timeout: 1000,
        signal: aborted(),
      }),
    ).rejects.toMatchObject(isAbort);
  });
});

describe('chain validation', () => {
  it('rejects a negative trim start', async () => {
    await expect(
      ffmscript(SAMPLE).trim({ start: -1, end: 5 }).save(out('ch.mp4')),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('rejects a trim end that is not greater than start', async () => {
    await expect(
      ffmscript(SAMPLE).trim({ start: 5, end: 3 }).save(out('ch.mp4')),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('builds quality + audio-bitrate args, probes for progress, and threads the signal', async () => {
    await expect(
      ffmscript(SAMPLE)
        .convert({ quality: 'high', audioBitrate: '128k' })
        .save(out('ch.mp4'), { onProgress: noop, signal: aborted() }),
    ).rejects.toMatchObject(isAbort);
  });

  it('builds a video-bitrate arg in the re-encode path', async () => {
    await expect(
      ffmscript(SAMPLE).convert({ videoBitrate: '1M' }).save(out('ch.mp4'), { signal: aborted() }),
    ).rejects.toMatchObject(isAbort);
  });
});
