import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmscript } from '../src/operations/chain.js';
import { probe } from '../src/operations/probe.js';
import { FileNotFoundError, InvalidFormatError, InvalidOptionsError } from '../src/errors/index.js';
import { SAMPLE, makeWatermark, makeSrt, makeMkvWithSubs } from './helpers.js';

describe('ffmscript (chainable API)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-chain-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('fuses trim + convert into a single pass', async () => {
    const output = join(dir, 'fused.mp4');
    await ffmscript(SAMPLE).trim({ start: 2, end: 5 }).convert({ width: 640 }).save(output);

    const info = await probe(output);
    expect(info.duration).toBeCloseTo(3, 0);
    expect(info.video?.width).toBe(640);
    expect(info.video?.height).toBe(360);
  }, 30_000);

  it('works with convert only', async () => {
    const output = join(dir, 'convert-only.mp4');
    await ffmscript(SAMPLE).convert({ width: 320 }).save(output);

    expect((await probe(output)).video?.width).toBe(320);
  }, 30_000);

  it('works with trim only and reports progress', async () => {
    const output = join(dir, 'trim-only.mp4');
    const percents: number[] = [];
    await ffmscript(SAMPLE)
      .trim({ start: 0, end: 4 })
      .save(output, { onProgress: (p) => percents.push(p.percent) });

    expect((await probe(output)).duration).toBeCloseTo(4, 0);
    expect(percents.length).toBeGreaterThan(0);
    expect(Math.max(...percents)).toBeLessThanOrEqual(100);
  }, 30_000);

  it('runs with raw args only, re-encoding the output', async () => {
    const output = join(dir, 'raw-only.mp4');
    // No trim/convert: .raw() alone is a valid operation and forces a re-encode.
    await ffmscript(SAMPLE).raw(['-c:v', 'libx264', '-crf', '30']).save(output);

    const info = await probe(output);
    expect(info.video?.codec).toBe('h264');
    expect(info.duration).toBeCloseTo(10, 0);
  }, 30_000);

  it('lets raw flags override the generated ones (raw -vf wins over the scale)', async () => {
    const output = join(dir, 'raw-override.mp4');
    // .convert({ width: 640 }) would scale to 640, but the raw -vf is appended
    // after it, and FFmpeg's last -vf wins → 320.
    await ffmscript(SAMPLE).convert({ width: 640 }).raw(['-vf', 'scale=320:-2']).save(output);

    expect((await probe(output)).video?.width).toBe(320);
  }, 30_000);

  it('fuses trim + raw into a single re-encoding pass', async () => {
    const output = join(dir, 'trim-raw.mp4');
    await ffmscript(SAMPLE).trim({ start: 1, end: 5 }).raw(['-vf', 'scale=320:-2']).save(output);

    const info = await probe(output);
    expect(info.duration).toBeCloseTo(4, 0);
    expect(info.video?.width).toBe(320);
  }, 30_000);

  it('throws InvalidOptionsError when nothing was queued', async () => {
    await expect(ffmscript(SAMPLE).save(join(dir, 'empty.mp4'))).rejects.toBeInstanceOf(
      InvalidOptionsError,
    );
  });

  it('throws InvalidFormatError when the output is not an .mp4', async () => {
    await expect(
      ffmscript(SAMPLE).convert({ width: 320 }).save(join(dir, 'out.mkv')),
    ).rejects.toBeInstanceOf(InvalidFormatError);
  });

  it('throws FileNotFoundError when the input is missing', async () => {
    await expect(
      ffmscript(join(dir, 'nope.mp4')).convert({ width: 320 }).save(join(dir, 'out.mp4')),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });

  describe('composable filters', () => {
    let watermark: string;
    let srt: string;
    let withSubs: string; // MKV carrying an embedded subtitle track

    beforeAll(() => {
      watermark = makeWatermark(dir);
      srt = makeSrt(dir);
      withSubs = makeMkvWithSubs(dir, srt);
    });

    it('fuses trim + scale + burnt subtitles + watermark into a single pass', async () => {
      const output = join(dir, 'filters-all.mp4');
      const percents: number[] = [];
      await ffmscript(SAMPLE)
        .trim({ start: 1, end: 5 })
        .convert({ width: 640, quality: 'small' })
        .burnSubtitles({ subtitles: srt })
        .overlay({ watermark, position: 'top-right', opacity: 0.6, width: 80 })
        .save(output, { onProgress: (p) => percents.push(p.percent) });

      const info = await probe(output);
      expect(info.duration).toBeCloseTo(4, 0);
      expect(info.video?.width).toBe(640); // the scale ran, and the overlay didn't resize the frame
      expect(info.video?.height).toBe(360);
      expect(info.video?.codec).toBe('h264');
      expect(info.audio?.codec).toBe('aac'); // audio survived the explicit mapping
      expect(percents.length).toBeGreaterThan(0);
      expect(Math.max(...percents)).toBeLessThanOrEqual(100);
    }, 60_000);

    it('works with a watermark alone (no other filter)', async () => {
      const output = join(dir, 'filters-overlay-only.mp4');
      await ffmscript(SAMPLE).overlay({ watermark }).save(output);

      const info = await probe(output);
      expect(info.video?.width).toBe(1280); // frame untouched
      expect(info.duration).toBeCloseTo(10, 0);
      expect(info.audio?.codec).toBe('aac');
    }, 60_000);

    it('burns an embedded subtitle track picked by index', async () => {
      const output = join(dir, 'filters-embedded-subs.mp4');
      await ffmscript(withSubs).burnSubtitles({ track: 0 }).convert({ width: 320 }).save(output);

      const info = await probe(output);
      expect(info.video?.width).toBe(320);
      // The burnt-in track is drawn into the picture, not muxed as a stream.
      expect(info.streams.filter((s) => s.type === 'subtitle')).toHaveLength(0);
    }, 60_000);

    it('defaults to the first embedded track when called with no options', async () => {
      const output = join(dir, 'filters-default-track.mp4');
      await ffmscript(withSubs).burnSubtitles().save(output);

      expect((await probe(output)).video?.codec).toBe('h264');
    }, 60_000);

    it('keeps a silent input working (the audio map is optional)', async () => {
      const silent = join(dir, 'silent-src.mp4');
      execFileSync('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-i',
        SAMPLE,
        '-an',
        '-c:v',
        'copy',
        silent,
      ]);

      const output = join(dir, 'filters-silent.mp4');
      await ffmscript(silent).overlay({ watermark }).save(output);

      const info = await probe(output);
      expect(info.audio).toBeNull();
      expect(info.video?.codec).toBe('h264');
    }, 60_000);

    it('throws FileNotFoundError when the watermark is missing', async () => {
      await expect(
        ffmscript(SAMPLE)
          .overlay({ watermark: join(dir, 'nope.png') })
          .save(join(dir, 'filters-no-wm.mp4')),
      ).rejects.toBeInstanceOf(FileNotFoundError);
    });

    it('validates the watermark options before spawning anything', async () => {
      await expect(
        ffmscript(SAMPLE)
          .overlay({ watermark, opacity: 2 })
          .save(join(dir, 'filters-bad-opacity.mp4')),
      ).rejects.toBeInstanceOf(InvalidOptionsError);
    });

    it('throws InvalidOptionsError for an out-of-range subtitle track', async () => {
      await expect(
        ffmscript(withSubs).burnSubtitles({ track: 9 }).save(join(dir, 'filters-bad-track.mp4')),
      ).rejects.toBeInstanceOf(InvalidOptionsError);
    });

    it('rejects raw filter/mapping flags next to a watermark', async () => {
      for (const flags of [
        ['-vf', 'scale=320:-2'],
        ['-filter_complex', '[0:v]null[out]'],
        ['-map', '0:v'],
      ]) {
        await expect(
          ffmscript(SAMPLE)
            .overlay({ watermark })
            .raw(flags)
            .save(join(dir, 'filters-raw-clash.mp4')),
        ).rejects.toBeInstanceOf(InvalidOptionsError);
      }
    });

    it('still allows raw flags that do not fight the filtergraph', async () => {
      const output = join(dir, 'filters-raw-ok.mp4');
      await ffmscript(SAMPLE).overlay({ watermark }).raw(['-crf', '30']).save(output);

      expect((await probe(output)).video?.codec).toBe('h264');
    }, 60_000);

    it('counts overlay/burnSubtitles as queued operations', async () => {
      // Neither trim, convert nor raw: the chain must not report an empty pipeline.
      const output = join(dir, 'filters-subs-only.mp4');
      await ffmscript(SAMPLE).burnSubtitles({ subtitles: srt }).save(output);

      expect((await probe(output)).video?.codec).toBe('h264');
    }, 60_000);
  });
});
