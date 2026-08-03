import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { validateInput } from '../core/validate.js';
import { VIDEO_INPUT_FORMATS } from '../core/formats.js';
import {
  buildSpriteFilter,
  buildVtt,
  planSpriteCues,
  resolveTileHeight,
  spriteSheetPattern,
} from '../core/sprites.js';
import { InvalidFormatError, InvalidOptionsError } from '../errors/index.js';
import type { SpriteFormat, SpriteOptions } from '../types/index.js';
import { probe } from './probe.js';

const DEFAULT_INTERVAL = 10;
const DEFAULT_TILE_WIDTH = 160;
const DEFAULT_COLUMNS = 5;
const DEFAULT_ROWS = 5;
const DEFAULT_FORMAT: SpriteFormat = 'jpg';

const FORMATS: SpriteFormat[] = ['jpg', 'png', 'webp'];

/**
 * Largest sheet edge we accept. Well under the encoders' own ceiling (mjpeg
 * stops at 65500), but past this browsers and mobile decoders start refusing
 * the image — a storyboard nobody can display is worse than a clear error.
 */
const MAX_SHEET_DIMENSION = 16384;

/** Name of the WebVTT file written next to the sheets. */
const VTT_NAME = 'storyboard.vtt';

/**
 * Generates a scrubbing storyboard: thumbnails sampled every `interval` seconds,
 * packed into `columns`×`rows` sprite sheets, plus the WebVTT file that maps each
 * moment of the timeline to its thumbnail.
 *
 * This is what players (video.js, hls.js, Plyr, JW) read to show a preview when
 * the viewer hovers the progress bar — the natural companion to {@link toHLS}.
 * Where {@link thumbnail} grabs one frame at one timestamp, this covers the whole
 * input.
 *
 * Layout, all inside `outputDir`: `sprite_000.<format>`, `sprite_001.<format>`, …
 * (a new sheet every `columns * rows` thumbnails) and `storyboard.vtt`, whose
 * cues reference the sheets by relative URL — so serving the directory as-is is
 * enough. Names are fixed, like the playlists of {@link toHLS}.
 *
 * @param input - Path to the source video file (MP4/MOV/WebM/MKV).
 * @param outputDir - Directory to write the sheets and the WebVTT into (created if needed).
 * @param options - Sampling interval, thumbnail width, grid, image format and progress/abort options.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when `input` is not a supported video format or carries no video stream.
 * @throws {InvalidOptionsError} when `interval`, `width`, `columns`, `rows` or `format` are out of range, or the resulting sheet would be too large to decode.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function toSprites(
  input: string,
  outputDir: string,
  options: SpriteOptions = {},
): Promise<void> {
  await validateInput(input, VIDEO_INPUT_FORMATS);

  const interval = options.interval ?? DEFAULT_INTERVAL;
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new InvalidOptionsError(
      `interval must be a positive number of seconds (got ${interval})`,
    );
  }
  const tileWidth = options.width ?? DEFAULT_TILE_WIDTH;
  if (!Number.isInteger(tileWidth) || tileWidth <= 0) {
    throw new InvalidOptionsError(`width must be a positive integer (got ${tileWidth})`);
  }
  const columns = options.columns ?? DEFAULT_COLUMNS;
  if (!Number.isInteger(columns) || columns <= 0) {
    throw new InvalidOptionsError(`columns must be a positive integer (got ${columns})`);
  }
  const rows = options.rows ?? DEFAULT_ROWS;
  if (!Number.isInteger(rows) || rows <= 0) {
    throw new InvalidOptionsError(`rows must be a positive integer (got ${rows})`);
  }
  const format = options.format ?? DEFAULT_FORMAT;
  if (!FORMATS.includes(format)) {
    throw new InvalidOptionsError(
      `unsupported sprite format "${format}" (expected ${FORMATS.join(', ')})`,
    );
  }

  // The probe drives everything downstream: the duration plans the cues, and the
  // source dimensions give the exact tile height the WebVTT has to describe.
  const info = await probe(input);
  if (info.video === null) {
    throw new InvalidFormatError(input, 'no video stream to build a storyboard from');
  }
  const tileHeight = resolveTileHeight(
    info.video.width,
    info.video.height,
    info.video.rotation,
    tileWidth,
  );

  const sheetWidth = columns * tileWidth;
  const sheetHeight = rows * tileHeight;
  if (sheetWidth > MAX_SHEET_DIMENSION || sheetHeight > MAX_SHEET_DIMENSION) {
    throw new InvalidOptionsError(
      `sheet would be ${sheetWidth}x${sheetHeight}px, over the ${MAX_SHEET_DIMENSION}px limit — ` +
        'lower columns/rows or width',
    );
  }

  const args = [
    '-i',
    input,
    // Sprites are picture-only; dropping the other streams keeps FFmpeg from
    // complaining about having nowhere to put them.
    '-an',
    '-sn',
    '-vf',
    buildSpriteFilter({ interval, tileWidth, tileHeight, columns, rows }),
  ];
  // Only meaningful for mjpeg; libwebp reads a different scale and png ignores it.
  if (format === 'jpg') args.push('-q:v', '4');
  // The image2 muxer numbers from 1 unless told otherwise, which would shift
  // every sheet name one step away from the indices the cues compute.
  args.push('-start_number', '0', '-y', join(outputDir, spriteSheetPattern(format)));

  await mkdir(outputDir, { recursive: true });

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args,
    duration: info.duration,
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });

  // `fps=1/interval` does not guarantee the thumbnail count to the frame — it
  // depends on where the source's last frame falls. So the planned count is
  // capped by the sheets FFmpeg actually wrote, and the VTT can never point at a
  // file that is not there. Unused cells of the final sheet stay unreferenced.
  const perSheet = columns * rows;
  const planned = Math.max(1, Math.ceil(info.duration / interval));
  const sheetPattern = new RegExp(`^sprite_\\d+\\.${format}$`);
  const sheets = (await readdir(outputDir)).filter((name) => sheetPattern.test(name)).length;
  const count = Math.min(planned, sheets * perSheet);

  const cues = planSpriteCues(count, {
    interval,
    duration: info.duration,
    columns,
    rows,
    tileWidth,
    tileHeight,
  });

  await writeFile(
    join(outputDir, VTT_NAME),
    buildVtt(cues, { tileWidth, tileHeight, format }),
    'utf8',
  );
}
