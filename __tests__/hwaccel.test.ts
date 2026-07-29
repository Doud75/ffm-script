import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildHwaccelArgs,
  parseHwaccels,
  listHwaccels,
  clearHwaccelCache,
} from '../src/core/hwaccel.js';
import { clearBinaryCache } from '../src/core/binary.js';
import { convert } from '../src/operations/convert.js';
import { parallelConvert } from '../src/operations/parallel.js';
import { ffmscript } from '../src/operations/chain.js';
import { probe } from '../src/operations/probe.js';
import { FFmpegNotFoundError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

describe('buildHwaccelArgs', () => {
  it('emits nothing when no method is requested', () => {
    expect(buildHwaccelArgs(undefined)).toEqual([]);
  });

  it('emits the -hwaccel flag for a method name', () => {
    expect(buildHwaccelArgs('cuda')).toEqual(['-hwaccel', 'cuda']);
    // 'none' is a legal FFmpeg value (explicit software decoding), not a way to opt out.
    expect(buildHwaccelArgs('none')).toEqual(['-hwaccel', 'none']);
  });

  it('passes an unknown method through rather than second-guessing FFmpeg', () => {
    expect(buildHwaccelArgs('some_future_api')).toEqual(['-hwaccel', 'some_future_api']);
  });

  it('rejects an empty or blank method name', () => {
    expect(() => buildHwaccelArgs('')).toThrow(InvalidOptionsError);
    expect(() => buildHwaccelArgs('   ')).toThrow(InvalidOptionsError);
  });
});

describe('parseHwaccels', () => {
  it('drops the header line and lists the methods', () => {
    const stdout = 'Hardware acceleration methods:\nvideotoolbox\nqsv\n';
    expect(parseHwaccels(stdout)).toEqual(['videotoolbox', 'qsv']);
  });

  it('trims whitespace and ignores blank lines', () => {
    const stdout = 'Hardware acceleration methods:\n  cuda  \n\n vaapi\n\n';
    expect(parseHwaccels(stdout)).toEqual(['cuda', 'vaapi']);
  });

  it('returns an empty list when the build supports none', () => {
    expect(parseHwaccels('Hardware acceleration methods:\n')).toEqual([]);
  });
});

describe('listHwaccels', () => {
  beforeEach(() => {
    clearHwaccelCache();
  });

  it('reports the methods this FFmpeg build was compiled with', async () => {
    const accels = await listHwaccels();

    expect(Array.isArray(accels)).toBe(true);
    // Whatever the host offers, every entry is a non-empty, single-token name —
    // proof the header line and blank lines were stripped.
    for (const accel of accels) {
      expect(accel).toMatch(/^\S+$/);
    }
  });

  it('memoizes the result, so repeat calls do not re-spawn FFmpeg', async () => {
    const first = listHwaccels();
    const second = listHwaccels();

    expect(second).toBe(first);
    await expect(second).resolves.toEqual(await first);
  });

  describe('when ffmpeg cannot be reached', () => {
    const saved = process.env.FFMPEG_PATH;

    beforeEach(() => {
      process.env.FFMPEG_PATH = join(tmpdir(), 'ffm-does-not-exist');
      clearBinaryCache();
    });

    afterEach(() => {
      if (saved === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = saved;
      clearBinaryCache();
      clearHwaccelCache();
    });

    it('rejects rather than throwing synchronously, and does not cache the failure', async () => {
      // Resolving the binary fails before anything is spawned; it still has to
      // come back as a rejected promise, so a caller's .catch() sees it.
      const failed = listHwaccels();
      expect(failed).toBeInstanceOf(Promise);
      await expect(failed).rejects.toBeInstanceOf(FFmpegNotFoundError);

      // A failure isn't memoized: once ffmpeg is reachable again, so is the list.
      if (saved === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = saved;
      clearBinaryCache();

      await expect(listHwaccels()).resolves.toEqual(expect.any(Array));
    });
  });
});

// A GPU is never guaranteed (CI has none), but `-hwaccel none` is a legal FFmpeg
// value meaning "decode in software" — it travels the exact same code path, so it
// proves the flag lands *before* the -i on every operation. FFmpeg rejects the
// option outright when it appears on the output side, so a passing run is the
// assertion.
describe('hwaccel (integration)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-hwaccel-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('convert accepts a decode method as an input option', async () => {
    const output = join(dir, 'convert.mp4');
    await convert(SAMPLE, output, { hwaccel: 'none', width: 320 });

    // The scale filter still applies: -hwaccel decodes, then hands frames back to
    // system memory, which is what keeps software filters composable.
    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.video?.width).toBe(320);
  }, 60_000);

  it('the chain places the decode method before its seek and input', async () => {
    const output = join(dir, 'chain.mp4');
    await ffmscript(SAMPLE)
      .trim({ start: 1, end: 3 })
      .convert({ hwaccel: 'none', width: 320 })
      .save(output);

    expect((await probe(output)).duration).toBeCloseTo(2, 0);
  }, 60_000);

  it('parallelConvert passes the decode method to every chunk', async () => {
    const output = join(dir, 'parallel.mp4');
    await parallelConvert(SAMPLE, output, { hwaccel: 'none', workers: 2 });

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.duration).toBeCloseTo(10, 0);
  }, 90_000);

  it('rejects a blank method before spawning anything', async () => {
    await expect(convert(SAMPLE, join(dir, 'x.mp4'), { hwaccel: '' })).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
    await expect(
      parallelConvert(SAMPLE, join(dir, 'x.mp4'), { hwaccel: '  ' }),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });
});
