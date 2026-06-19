import { extname } from 'node:path';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { validateInput } from '../core/validate.js';
import { VIDEO_INPUT_FORMATS } from '../core/formats.js';
import { parseTimestamp } from '../core/time.js';
import { buildScaleFilter } from '../core/scale.js';
import { qualityArgs, assertQualityBitrateExclusive } from '../core/quality.js';
import { InvalidFormatError, InvalidOptionsError } from '../errors/index.js';
import type { ConvertOptions, Progress, TrimOptions } from '../types/index.js';
import { probe } from './probe.js';

const DEFAULT_VIDEO_CODEC = 'libx264';
const DEFAULT_AUDIO_CODEC = 'aac';

/** Execution options for {@link FfmScriptChain.save}. */
export interface SaveOptions {
  onProgress?: (progress: Progress) => void;
  signal?: AbortSignal;
}

/**
 * Fluent builder that fuses `trim` and `convert` into a **single** FFmpeg pass.
 *
 * `trim` and `convert` are order-independent: trimming defines the input
 * segment, the rest applies to it. Create one via {@link ffmscript}.
 */
export class FfmScriptChain {
  readonly #input: string;
  #trim: TrimOptions | undefined;
  #convert: ConvertOptions | undefined;
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
   */
  raw(args: string[]): this {
    this.#raw = args;
    return this;
  }

  /**
   * Runs the accumulated operations as one FFmpeg command and writes `output`.
   *
   * @throws {FileNotFoundError} when the input does not exist.
   * @throws {InvalidFormatError} when the input is not a supported video format or `output` is not `.mp4`.
   * @throws {InvalidOptionsError} when no operation was queued or a timestamp/range is invalid.
   */
  async save(output: string, options: SaveOptions = {}): Promise<void> {
    await validateInput(this.#input, VIDEO_INPUT_FORMATS);
    if (extname(output).toLowerCase() !== '.mp4') {
      throw new InvalidFormatError(output, 'output must be an .mp4 file');
    }
    if (this.#trim === undefined && this.#convert === undefined && this.#raw === undefined) {
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

    // Re-encode when converting, for a frame-accurate (precise) trim, or when raw
    // flags are injected (they customize the output encode); otherwise a plain
    // keyframe-bound stream copy is enough.
    const reencode =
      this.#convert !== undefined ||
      (this.#trim?.mode ?? 'fast') === 'precise' ||
      this.#raw !== undefined;

    const args: string[] = [];
    if (start !== undefined) args.push('-ss', String(start));
    args.push('-i', this.#input);
    if (trimDuration !== undefined) args.push('-t', String(trimDuration));

    const scale = buildScaleFilter(this.#convert?.width, this.#convert?.height);
    if (scale !== undefined) args.push('-vf', scale);

    if (reencode) {
      args.push('-c:v', this.#convert?.videoCodec ?? DEFAULT_VIDEO_CODEC);
      if (this.#convert?.quality !== undefined) args.push(...qualityArgs(this.#convert.quality));
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
      trimDuration ?? (options.onProgress !== undefined ? (await probe(this.#input)).duration : undefined);

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
