import type { SpriteFormat } from '../types/index.js';

/** Basename prefix shared by every sprite sheet. */
const SHEET_PREFIX = 'sprite_';

/** How many digits FFmpeg's `%03d` output pattern pads sheet indices to. */
const INDEX_DIGITS = 3;

/** Geometry of one thumbnail: where it sits on its sheet, and what it covers. */
export interface SpriteCue {
  /** Cue start in seconds. */
  start: number;
  /** Cue end in seconds (never past the input duration). */
  end: number;
  /** Index of the sheet holding this thumbnail (0-based). */
  sheetIndex: number;
  /** X offset of the thumbnail inside its sheet, in pixels. */
  x: number;
  /** Y offset of the thumbnail inside its sheet, in pixels. */
  y: number;
}

/**
 * FFmpeg output pattern for the sheets. The `image2` muxer expands `%03d` — it
 * numbers from 1 by default, so the caller must pass `-start_number 0` to keep
 * the files aligned with {@link spriteSheetName}.
 */
export function spriteSheetPattern(format: SpriteFormat): string {
  return `${SHEET_PREFIX}%0${INDEX_DIGITS}d.${format}`;
}

/** Name of one sheet, matching what {@link spriteSheetPattern} makes FFmpeg write. */
export function spriteSheetName(index: number, format: SpriteFormat): string {
  return `${SHEET_PREFIX}${String(index).padStart(INDEX_DIGITS, '0')}.${format}`;
}

/**
 * Height of one thumbnail, in pixels, preserving the source aspect ratio.
 *
 * Everywhere else the library hands `-2` to FFmpeg's `scale` and lets it derive
 * the missing dimension. That is not an option here: the WebVTT file describes
 * every thumbnail with an `#xywh=` media fragment, so the exact pixel geometry
 * has to be known *before* FFmpeg runs. A rotated source (90°/270°) is displayed
 * with its dimensions swapped, which is what `scale` operates on. The result is
 * rounded to an even number — the encoders behind the sprite formats expect it.
 */
export function resolveTileHeight(
  sourceWidth: number,
  sourceHeight: number,
  rotation: number,
  tileWidth: number,
): number {
  const rotated = rotation === 90 || rotation === 270;
  const displayWidth = rotated ? sourceHeight : sourceWidth;
  const displayHeight = rotated ? sourceWidth : sourceHeight;
  return Math.max(2, 2 * Math.round((displayHeight * tileWidth) / displayWidth / 2));
}

/**
 * Builds the `-vf` chain that turns a video into sprite sheets: `fps` samples
 * one frame every `interval` seconds, `scale` shrinks it to the tile size, and
 * `tile` packs the frames into a `columns`×`rows` grid — one output image per
 * full grid. Pure (no I/O, no spawn), unit-tested directly.
 */
export function buildSpriteFilter(options: {
  interval: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
}): string {
  const { interval, tileWidth, tileHeight, columns, rows } = options;
  return `fps=1/${interval},scale=${tileWidth}:${tileHeight},tile=${columns}x${rows}`;
}

/**
 * Lays `count` thumbnails out over the timeline and over the sheet grid: each
 * one covers `interval` seconds (the last is clipped to `duration`) and lands at
 * its row/column offset on the sheet it belongs to. Pure, unit-tested directly.
 */
export function planSpriteCues(
  count: number,
  options: {
    interval: number;
    duration: number;
    columns: number;
    rows: number;
    tileWidth: number;
    tileHeight: number;
  },
): SpriteCue[] {
  const { interval, duration, columns, rows, tileWidth, tileHeight } = options;
  const perSheet = columns * rows;

  return Array.from({ length: count }, (_, i) => {
    const cell = i % perSheet;
    return {
      start: i * interval,
      end: Math.min((i + 1) * interval, duration),
      sheetIndex: Math.floor(i / perSheet),
      x: (cell % columns) * tileWidth,
      y: Math.floor(cell / columns) * tileHeight,
    };
  });
}

/**
 * Formats seconds as a WebVTT timestamp (`HH:MM:SS.mmm`). The hours field is
 * optional in the spec but always emitted here — every player accepts it, and a
 * fixed width keeps the file diff-friendly.
 */
export function formatVttTimestamp(seconds: number): string {
  const total = Math.round(Math.max(0, seconds) * 1000);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const secs = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;

  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(millis, 3)}`;
}

/**
 * Renders the storyboard WebVTT document. Each cue points at its sheet with a
 * relative URL plus an `#xywh=` media fragment — the format players (video.js,
 * hls.js, Plyr, JW) read to crop the right thumbnail out of the sheet. The URL
 * is relative because the `.vtt` is written next to the sheets.
 */
export function buildVtt(
  cues: SpriteCue[],
  options: { tileWidth: number; tileHeight: number; format: SpriteFormat },
): string {
  const { tileWidth, tileHeight, format } = options;

  const blocks = cues.map((cue) => {
    const range = `${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}`;
    const sheet = spriteSheetName(cue.sheetIndex, format);
    return `${range}\n${sheet}#xywh=${cue.x},${cue.y},${tileWidth},${tileHeight}`;
  });

  if (blocks.length === 0) return 'WEBVTT\n';
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}
