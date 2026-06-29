import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractKeyframeIndex } from '../src/core/mp4.js';
import { InvalidFormatError } from '../src/errors/index.js';

// --- Minimal ISOBMFF box builders -----------------------------------------
// These craft just enough of an MP4 to exercise every branch of the pure
// binary parser in src/core/mp4.ts — no FFmpeg, fully deterministic.

const str = (s: string): Buffer => Buffer.from(s, 'latin1');
const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};

/** Standard 32-bit-size box: [size:u32][type:4][payload]. */
function box(type: string, ...parts: Buffer[]): Buffer {
  const payload = Buffer.concat(parts);
  return Buffer.concat([u32(8 + payload.length), str(type), payload]);
}

/** 64-bit-size box: size field is 1, the real size follows as a u64. */
function box64(type: string, ...parts: Buffer[]): Buffer {
  const payload = Buffer.concat(parts);
  const head = Buffer.alloc(16);
  head.writeUInt32BE(1, 0);
  head.write(type, 4, 'latin1');
  head.writeBigUInt64BE(BigInt(16 + payload.length), 8);
  return Buffer.concat([head, payload]);
}

/** Box declared with size 0 → "extends to end of file" (only valid last). */
function boxSize0(type: string, ...parts: Buffer[]): Buffer {
  return Buffer.concat([u32(0), str(type), Buffer.concat(parts)]);
}

function hdlr(handlerType: string): Buffer {
  // version/flags(4) + pre_defined(4) + handler_type(4) + reserved(12) + name(1)
  return box('hdlr', Buffer.alloc(8), str(handlerType), Buffer.alloc(13));
}

function mdhd(version: 0 | 1, timescale: number): Buffer {
  if (version === 1) {
    // v/f(4) + creation(8) + modification(8) + timescale(4)@20 + duration(8)
    const p = Buffer.alloc(36);
    p.writeUInt8(1, 0);
    p.writeUInt32BE(timescale >>> 0, 20);
    return box('mdhd', p);
  }
  // v0: v/f(4) + creation(4) + modification(4) + timescale(4)@12 + duration(4)
  const p = Buffer.alloc(24);
  p.writeUInt32BE(timescale >>> 0, 12);
  return box('mdhd', p);
}

function stts(runs: { count: number; delta: number }[]): Buffer {
  const entries = runs.map((r) => Buffer.concat([u32(r.count), u32(r.delta)]));
  return box('stts', Buffer.alloc(4), u32(runs.length), ...entries);
}

function stss(samples: number[]): Buffer {
  return box('stss', Buffer.alloc(4), u32(samples.length), ...samples.map(u32));
}

type OmitBox = 'mdia' | 'hdlr' | 'mdhd' | 'minf' | 'stbl' | 'stts';

interface TrakOpts {
  handler?: string;
  mdhdVersion?: 0 | 1;
  timescale?: number;
  runs?: { count: number; delta: number }[];
  stssSamples?: number[] | null; // null → omit the stss box (all-intra)
  omit?: OmitBox;
  use64?: boolean;
}

function buildTrak(o: TrakOpts = {}): Buffer {
  const {
    handler = 'vide',
    mdhdVersion = 0,
    timescale = 1000,
    runs = [{ count: 1, delta: 0 }],
    stssSamples = [1],
    omit,
    use64 = false,
  } = o;
  const wrap = use64 ? box64 : box;
  if (omit === 'mdia') return wrap('trak');

  const stblKids: Buffer[] = [];
  if (omit !== 'stts') stblKids.push(stts(runs));
  if (stssSamples !== null) stblKids.push(stss(stssSamples));
  const stbl = box('stbl', ...stblKids);
  const minf = box('minf', ...(omit === 'stbl' ? [] : [stbl]));

  const mdiaKids: Buffer[] = [];
  if (omit !== 'hdlr') mdiaKids.push(hdlr(handler));
  if (omit !== 'mdhd') mdiaKids.push(mdhd(mdhdVersion, timescale));
  if (omit !== 'minf') mdiaKids.push(minf);
  return wrap('trak', box('mdia', ...mdiaKids));
}

describe('extractKeyframeIndex (synthetic ISOBMFF)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-mp4-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const ftyp = box('ftyp', str('isom'), u32(0x200), str('isomiso2mp41'));

  function write(name: string, moov: Buffer): string {
    const p = join(dir, name);
    writeFileSync(p, Buffer.concat([ftyp, moov]));
    return p;
  }

  const ts = (kf: { timestamp: number }[]) => kf.map((k) => k.timestamp);

  it('parses a 64-bit moov + 64-bit trak with a v1 mdhd, multi-run stts and a sample past the table', async () => {
    // stts: samples 1-2 @ delta 500, samples 3-5 @ delta 1000 (timescale 1000).
    // stss [1, 3, 6]: 6 is beyond the 5 described samples → falls back to the
    // accumulated run time (4000 ticks = 4s).
    const trak = buildTrak({
      use64: true,
      mdhdVersion: 1,
      timescale: 1000,
      runs: [
        { count: 2, delta: 500 },
        { count: 3, delta: 1000 },
      ],
      stssSamples: [1, 3, 6],
    });
    const file = write('full.mp4', box64('moov', trak));

    expect(ts(await extractKeyframeIndex(file))).toEqual([0, 1, 4]);
  });

  it('maps every sample to 0 when the timescale is 0 (stss path)', async () => {
    const trak = buildTrak({
      timescale: 0,
      runs: [{ count: 3, delta: 100 }],
      stssSamples: [1, 2, 3],
    });
    const file = write('ts0.mp4', box('moov', trak));

    expect(ts(await extractKeyframeIndex(file))).toEqual([0, 0, 0]);
  });

  it('treats every sample as a keyframe when stss is absent (all-intra)', async () => {
    const trak = buildTrak({ timescale: 100, runs: [{ count: 3, delta: 50 }], stssSamples: null });
    const file = write('allintra.mp4', box('moov', trak));

    expect(ts(await extractKeyframeIndex(file))).toEqual([0, 0.5, 1]);
  });

  it('all-intra with a 0 timescale yields zeros', async () => {
    const trak = buildTrak({ timescale: 0, runs: [{ count: 2, delta: 10 }], stssSamples: null });
    const file = write('allintra-ts0.mp4', box('moov', trak));

    expect(ts(await extractKeyframeIndex(file))).toEqual([0, 0]);
  });

  it('reads a moov declared with size 0 (extends to EOF)', async () => {
    const trak = buildTrak({ timescale: 1000, runs: [{ count: 1, delta: 0 }], stssSamples: [1] });
    const file = write('size0.mp4', boxSize0('moov', trak));

    expect(ts(await extractKeyframeIndex(file))).toEqual([0]);
  });

  it('skips a malformed track and uses the next valid video track', async () => {
    const file = write('skip.mp4', box('moov', buildTrak({ omit: 'mdia' }), buildTrak({})));

    expect(ts(await extractKeyframeIndex(file))).toEqual([0]);
  });

  it('throws when the only track is audio (handler is not "vide")', async () => {
    const file = write('audio.mp4', box('moov', buildTrak({ handler: 'soun' })));

    await expect(extractKeyframeIndex(file)).rejects.toThrow(/no video track/);
  });

  it('throws InvalidFormatError when there is no moov box', async () => {
    const p = join(dir, 'nomoov.mp4');
    writeFileSync(p, Buffer.concat([ftyp, box('free', Buffer.alloc(8))]));

    await expect(extractKeyframeIndex(p)).rejects.toBeInstanceOf(InvalidFormatError);
    await expect(extractKeyframeIndex(p)).rejects.toThrow(/no moov box/);
  });

  it.each<OmitBox>(['hdlr', 'mdhd', 'minf', 'stbl', 'stts'])(
    'throws "no video track" when the %s box is missing',
    async (omit) => {
      const file = write(`missing-${omit}.mp4`, box('moov', buildTrak({ omit })));

      await expect(extractKeyframeIndex(file)).rejects.toThrow(/no video track/);
    },
  );
});
