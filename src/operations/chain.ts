import { extname } from 'node:path';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { validateInput } from '../core/validate.js';
import { VIDEO_INPUT_FORMATS, IMAGE_INPUT_FORMATS } from '../core/formats.js';
import { parseTimestamp } from '../core/time.js';
import { buildScaleFilter } from '../core/scale.js';
import { buildFilterGraph } from '../core/filtergraph.js';
import { resolveOverlayParams } from '../core/overlay.js';
import { qualityArgs, assertQualityBitrateExclusive } from '../core/quality.js';
import { buildHwaccelArgs } from '../core/hwaccel.js';
import { InvalidFormatError, InvalidOptionsError } from '../errors/index.js';
import type {
  BurnSubtitlesOptions,
  ConvertOptions,
  OverlayOptions,
  Progress,
  TrimOptions,
} from '../types/index.js';
import { probe } from './probe.js';
import { resolveBurnSubtitlesFilter } from './subtitles.js';

const DEFAULT_VIDEO_CODEC = 'libx264';
const DEFAULT_AUDIO_CODEC = 'aac';

/**
 * Raw flags that cannot coexist with a watermark. A watermark needs a second input
 * wired through a `-filter_complex` and mapped explicitly, so any of these would
 * silently replace that graph (or drop the mapping) and produce a wrong output
 * instead of a readable error.
 *
 * Only the watermark is this strict: without it the filters are a plain `-vf`,
 * which a raw `-vf` is documented to override.
 */
const CONFLICTING_RAW_FLAGS = ['-vf', '-filter:v', '-filter_complex', '-map'];

/**
 * @throws {InvalidOptionsError} when `raw` carries a flag from
 * {@link CONFLICTING_RAW_FLAGS}.
 */
function assertRawFilterFree(raw: string[] | undefined): void {
  const clash = raw?.find((arg) => CONFLICTING_RAW_FLAGS.includes(arg));
  if (clash !== undefined) {
    throw new InvalidOptionsError(
      `.raw() cannot pass "${clash}" together with .overlay(): the watermark is built as a ` +
        '-filter_complex with explicit stream mapping, which that flag would override. ' +
        'Drop the .overlay() and build the whole graph in .raw(), or drop that flag',
    );
  }
}

/** Execution options for {@link FfmScriptChain.save}. */
export interface SaveOptions {
  onProgress?: (progress: Progress) => void;
  signal?: AbortSignal;
}

/**
 * Fluent builder that fuses `trim`, `convert`, `burnSubtitles` and `overlay` into
 * a **single** FFmpeg pass.
 *
 * The calls are order-independent: trimming defines the input segment, the rest
 * applies to it, and the video filters always run in the fixed order
 * scale → subtitles → overlay (see {@link buildFilterGraph}). Create one via
 * {@link ffmscript}.
 */
export class FfmScriptChain {
  readonly #input: string;
  #trim: TrimOptions | undefined;
  #convert: ConvertOptions | undefined;
  #overlay: OverlayOptions | undefined;
  #subtitles: BurnSubtitlesOptions | undefined;
  #raw: string[] | undefined;

  constructor(input: string) {
    this.#input = input;
  }

  trim(options: TrimOptions): this {
    this.#trim = options;
    return this;
  }

  convert(options: ConvertOptions): this {
    this.#convert = options;
    return this;
  }

  /**
   * Lays a watermark image over the picture, in the same pass as the rest — the
   * in-chain counterpart to {@link overlay}. Stacks **on top** of subtitles burnt
   * in by {@link FfmScriptChain.burnSubtitles}.
   *
   * The image is added as a second FFmpeg input, so the pass switches to a
   * `-filter_complex` with explicit stream mapping; `.raw()` flags that would
   * fight it (`-vf`, `-filter_complex`, `-map`) are rejected by `save()`.
   *
   * `onProgress`/`signal` on the options are ignored — they belong to `save()`.
   * The last `.overlay()` call wins.
   */
  overlay(options: OverlayOptions): this {
    this.#overlay = options;
    return this;
  }

  /**
   * Burns subtitles into the picture, in the same pass as the rest — the in-chain
   * counterpart to {@link burnSubtitles}. Reads an external file
   * (`options.subtitles`) or an embedded `track` of the input.
   *
   * They are rendered **after** any `.convert({ width })` scaling, so the text is
   * drawn at the output resolution instead of being burnt in then resampled.
   *
   * `onProgress`/`signal` on the options are ignored — they belong to `save()`.
   * The last `.burnSubtitles()` call wins.
   */
  burnSubtitles(options: BurnSubtitlesOptions = {}): this {
    this.#subtitles = options;
    return this;
  }

  /**
   * Injects raw FFmpeg arguments into the pipeline — the in-chain escape hatch,
   * the counterpart to {@link run} but fused with `trim`/`convert` in one pass.
   *
   * The flags are appended to the **output** side of the command, after the
   * options generated from `trim`/`convert`, so an explicit flag wins over a
   * generated one (a `-vf` here overrides the scale built from `.convert({ width })`).
   *
   * Forces a re-encode: these customize the output encode and are incompatible
   * with the stream-copy fast path. For pure stream-copy or muxer-only tweaks,
   * reach for {@link run} instead. The last `.raw()` call wins.
   *
   * The one combination that is rejected rather than overridden is a filter or
   * mapping flag next to {@link FfmScriptChain.overlay} — see
   * {@link CONFLICTING_RAW_FLAGS}.
   */
  raw(args: string[]): this {
    this.#raw = args;
    return this;
  }

  /**
   * Runs the accumulated operations as one FFmpeg command and writes `output`.
   *
   * @throws {FileNotFoundError} when the input, the watermark or an external subtitle file does not exist.
   * @throws {InvalidFormatError} when the input is not a supported video format, `output` is not `.mp4`, the watermark/subtitle file has an unsupported extension, or an embedded subtitle track was asked for and the input has none.
   * @throws {InvalidOptionsError} when no operation was queued, a timestamp/range is invalid, `quality` is combined with a bitrate or with an encoder that has no known preset scale, a watermark option is out of range, or `.raw()` fights the watermark's filtergraph.
   */
  async save(output: string, options: SaveOptions = {}): Promise<void> {
    await validateInput(this.#input, VIDEO_INPUT_FORMATS);
    if (extname(output).toLowerCase() !== '.mp4') {
      throw new InvalidFormatError(output, 'output must be an .mp4 file');
    }
    if (
      this.#trim === undefined &&
      this.#convert === undefined &&
      this.#overlay === undefined &&
      this.#subtitles === undefined &&
      this.#raw === undefined
    ) {
      throw new InvalidOptionsError('chain requires at least one operation before save()');
    }
    assertQualityBitrateExclusive(this.#convert?.quality, this.#convert?.videoBitrate);

    let start: number | undefined;
    let trimDuration: number | undefined;
    if (this.#trim !== undefined) {
      start = parseTimestamp(this.#trim.start, 'start');
      const end = parseTimestamp(this.#trim.end, 'end');
      if (start < 0) {
        throw new InvalidOptionsError(`trim start must be >= 0 (got ${start}s)`);
      }
      if (end <= start) {
        throw new InvalidOptionsError(`trim end (${end}s) must be greater than start (${start}s)`);
      }
      trimDuration = end - start;
    }

    // Every video filter is resolved (and its options validated) before FFmpeg is
    // spawned, so a bad option fails without launching a process. The sync checks
    // run first, then the ones that need the filesystem or a probe.
    const scale = buildScaleFilter(this.#convert?.width, this.#convert?.height);
    const overlayParams =
      this.#overlay !== undefined ? resolveOverlayParams(this.#overlay) : undefined;
    if (overlayParams !== undefined) assertRawFilterFree(this.#raw);
    if (this.#overlay !== undefined) {
      await validateInput(this.#overlay.watermark, IMAGE_INPUT_FORMATS);
    }
    const subtitles =
      this.#subtitles !== undefined
        ? await resolveBurnSubtitlesFilter(this.#input, this.#subtitles)
        : undefined;

    // Re-encode when converting, when a filter changes the picture, for a
    // frame-accurate (precise) trim, or when raw flags are injected (they customize
    // the output encode); otherwise a plain keyframe-bound stream copy is enough.
    const reencode =
      this.#convert !== undefined ||
      this.#overlay !== undefined ||
      this.#subtitles !== undefined ||
      (this.#trim?.mode ?? 'fast') === 'precise' ||
      this.#raw !== undefined;

    // Input options, in FFmpeg's expected order: they all apply to the -i that follows.
    const args: string[] = buildHwaccelArgs(this.#convert?.hwaccel);
    if (start !== undefined) args.push('-ss', String(start));
    args.push('-i', this.#input);
    // The watermark is a second input, so it must be declared before -t, which is
    // an *output* option and only reads as one once every input is in place.
    if (this.#overlay !== undefined) args.push('-i', this.#overlay.watermark);
    if (trimDuration !== undefined) args.push('-t', String(trimDuration));

    args.push(...buildFilterGraph({ scale, subtitles, overlay: overlayParams }));

    if (reencode) {
      const videoCodec = this.#convert?.videoCodec ?? DEFAULT_VIDEO_CODEC;
      args.push('-c:v', videoCodec);
      if (this.#convert?.quality !== undefined) {
        args.push(...qualityArgs(this.#convert.quality, videoCodec));
      }
      if (this.#convert?.videoBitrate !== undefined) args.push('-b:v', this.#convert.videoBitrate);
      args.push('-c:a', this.#convert?.audioCodec ?? DEFAULT_AUDIO_CODEC);
      if (this.#convert?.audioBitrate !== undefined) args.push('-b:a', this.#convert.audioBitrate);
    } else {
      args.push('-c', 'copy');
    }

    // Raw args last, so explicit user flags override the generated ones.
    if (this.#raw !== undefined) args.push(...this.#raw);

    args.push('-y', output);

    // Progress needs a total duration: the trim length, else the input's.
    const duration =
      trimDuration ??
      (options.onProgress !== undefined ? (await probe(this.#input)).duration : undefined);

    await spawnFFmpeg({
      binary: resolveBinary('ffmpeg'),
      args,
      ...(duration !== undefined ? { duration } : {}),
      ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  }
}

/**
 * Entry point for the chainable API.
 *
 * @example
 * await ffmscript('input.mp4')
 *   .trim({ start: 60, end: 180 })
 *   .convert({ width: 1280 })
 *   .save('output.mp4')
 */
export function ffmscript(input: string): FfmScriptChain {
  return new FfmScriptChain(input);
}
