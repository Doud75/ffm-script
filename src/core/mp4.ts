import { open } from 'node:fs/promises';
import { InvalidFormatError } from '../errors/index.js';
import type { Keyframe } from '../types/index.js';

/**
 * Extracts the keyframe (sync sample) index of an MP4's video track by parsing
 * the ISOBMFF boxes directly — no FFmpeg involved.
 *
 * Reads the `moov` box, locates the video track, and combines its `stss`
 * (sync samples) with `stts` (sample durations) and the media timescale to turn
 * sample numbers into timestamps in seconds.
 *
 * When the `stss` box is absent, the ISOBMFF spec says every sample is a sync
 * sample — an all-intra stream where each frame is independently decodable.
 * In that case every frame is returned as a keyframe, so callers can still cut
 * on frame boundaries anywhere.
 *
 * @throws {InvalidFormatError} when the file has no `moov` or no video track.
 */
export async function extractKeyframeIndex(path: string): Promise<Keyframe[]> {
  const moov = await readMoovPayload(path);
  const dv = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);

  for (const trak of boxesOfType(dv, 0, moov.byteLength, 'trak')) {
    const mdia = findBox(dv, trak.start, trak.end, 'mdia');
    if (mdia === undefined) continue;

    const hdlr = findBox(dv, mdia.start, mdia.end, 'hdlr');
    // handler_type sits after the full-box header (4) + pre_defined (4).
    if (hdlr === undefined || boxType(dv, hdlr.start + 8) !== 'vide') continue;

    const mdhd = findBox(dv, mdia.start, mdia.end, 'mdhd');
    const minf = findBox(dv, mdia.start, mdia.end, 'minf');
    if (mdhd === undefined || minf === undefined) continue;
    const stbl = findBox(dv, minf.start, minf.end, 'stbl');
    if (stbl === undefined) continue;

    const stts = findBox(dv, stbl.start, stbl.end, 'stts');
    const stss = findBox(dv, stbl.start, stbl.end, 'stss');
    if (stts === undefined) continue;

    const timescale = readTimescale(dv, mdhd);
    const runs = readStts(dv, stts);

    // No stss → all-intra by spec: every sample is a sync sample. Return them all.
    const times =
      stss === undefined
        ? allSampleStartTimes(runs, timescale)
        : sampleStartTimes(runs, readStss(dv, stss), timescale);
    return times.map((timestamp) => ({ timestamp }));
  }

  throw new InvalidFormatError(path, 'no video track found');
}

interface Box {
  type: string;
  /** Offset of the box payload (after the header). */
  start: number;
  /** Offset just past the end of the box. */
  end: number;
}

/** Yields the boxes directly contained in the region `[start, end)`. */
function* boxes(dv: DataView, start: number, end: number): Generator<Box> {
  let off = start;
  while (off + 8 <= end) {
    let size = dv.getUint32(off);
    const type = boxType(dv, off + 4);
    let header = 8;
    if (size === 1) {
      size = Number(dv.getBigUint64(off + 8));
      header = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < header || off + size > end) break;
    yield { type, start: off + header, end: off + size };
    off += size;
  }
}

function* boxesOfType(dv: DataView, start: number, end: number, type: string): Generator<Box> {
  for (const box of boxes(dv, start, end)) {
    if (box.type === type) yield box;
  }
}

function findBox(dv: DataView, start: number, end: number, type: string): Box | undefined {
  for (const box of boxes(dv, start, end)) {
    if (box.type === type) return box;
  }
  return undefined;
}

function boxType(dv: DataView, off: number): string {
  return String.fromCharCode(
    dv.getUint8(off),
    dv.getUint8(off + 1),
    dv.getUint8(off + 2),
    dv.getUint8(off + 3),
  );
}

/** `mdhd` timescale, accounting for the version-0/1 layout difference. */
function readTimescale(dv: DataView, mdhd: Box): number {
  const version = dv.getUint8(mdhd.start);
  return dv.getUint32(mdhd.start + (version === 1 ? 20 : 12));
}

/** `stss` sync sample numbers (1-based). */
function readStss(dv: DataView, stss: Box): number[] {
  const count = dv.getUint32(stss.start + 4);
  const samples: number[] = [];
  let off = stss.start + 8;
  for (let i = 0; i < count; i++, off += 4) samples.push(dv.getUint32(off));
  return samples;
}

interface SttsRun {
  count: number;
  delta: number;
}

/** `stts` time-to-sample run-length entries. */
function readStts(dv: DataView, stts: Box): SttsRun[] {
  const count = dv.getUint32(stts.start + 4);
  const runs: SttsRun[] = [];
  let off = stts.start + 8;
  for (let i = 0; i < count; i++, off += 8) {
    runs.push({ count: dv.getUint32(off), delta: dv.getUint32(off + 4) });
  }
  return runs;
}

/**
 * Maps (sorted, 1-based) sample numbers to their start time in seconds, walking
 * the run-length `stts` table once.
 */
function sampleStartTimes(stts: SttsRun[], samples: number[], timescale: number): number[] {
  const out: number[] = [];
  let runIndex = 0;
  let runFirstSample = 1;
  let runFirstTime = 0;

  for (const sample of samples) {
    let run = stts[runIndex];
    while (run !== undefined && sample >= runFirstSample + run.count) {
      runFirstTime += run.count * run.delta;
      runFirstSample += run.count;
      runIndex += 1;
      run = stts[runIndex];
    }
    const time = run === undefined ? runFirstTime : runFirstTime + (sample - runFirstSample) * run.delta;
    out.push(timescale > 0 ? time / timescale : 0);
  }
  return out;
}

/**
 * Start time (in seconds) of every sample, walking the run-length `stts` table.
 * Used for all-intra streams where each frame is a sync sample.
 */
function allSampleStartTimes(stts: SttsRun[], timescale: number): number[] {
  const out: number[] = [];
  let time = 0;
  for (const run of stts) {
    for (let i = 0; i < run.count; i++) {
      out.push(timescale > 0 ? time / timescale : 0);
      time += run.delta;
    }
  }
  return out;
}

/** Reads the `moov` box payload without loading the (potentially huge) `mdat`. */
async function readMoovPayload(path: string): Promise<Buffer> {
  const fh = await open(path, 'r');
  try {
    const { size: fileSize } = await fh.stat();
    let offset = 0;
    const header = Buffer.alloc(16);

    while (offset + 8 <= fileSize) {
      const { bytesRead } = await fh.read(header, 0, 16, offset);
      if (bytesRead < 8) break;

      let size = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      let headerSize = 8;
      if (size === 1) {
        size = Number(header.readBigUInt64BE(8));
        headerSize = 16;
      } else if (size === 0) {
        size = fileSize - offset;
      }
      if (size < headerSize) break;

      if (type === 'moov') {
        const payload = Buffer.alloc(size - headerSize);
        await fh.read(payload, 0, payload.length, offset + headerSize);
        return payload;
      }
      offset += size;
    }
    throw new InvalidFormatError(path, 'no moov box found (not a valid MP4?)');
  } finally {
    await fh.close();
  }
}
