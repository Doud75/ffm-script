import { mkdir } from 'node:fs/promises';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { validateInput } from '../core/validate.js';
import { AUDIO_INPUT_FORMATS, VIDEO_INPUT_FORMATS } from '../core/formats.js';
import { buildAudioHLSArgs, buildVideoHLSArgs } from '../core/hls.js';
import { InvalidOptionsError } from '../errors/index.js';
import type { AudioHLSOptions, HLSOptions, SegmentType } from '../types/index.js';
import { probe } from './probe.js';

const DEFAULT_SEGMENT_DURATION = 6;
const DEFAULT_SEGMENT_TYPE: SegmentType = 'ts';
const DEFAULT_AUDIO_BITRATES = ['128k'];

/**
 * Packages a video file into adaptive-bitrate HLS: one variant per requested
 * resolution plus a `master.m3u8` playlist, written under `outputDir`.
 *
 * Layout: `outputDir/master.m3u8` + one sub-folder per variant (named by its
 * width, or by `resolution.name`) containing `playlist.m3u8` and its segments
 * (`.ts` by default, or `.m4s` + an `init.mp4` when `segmentType` is `'fmp4'`).
 *
 * @param input - Path to the source video file (MP4/MOV/WebM/MKV).
 * @param outputDir - Directory to write the playlists and segments into (created if needed).
 * @param options - The resolution ladder, segment duration/type and progress/abort options.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when `input` is not a supported video format.
 * @throws {InvalidOptionsError} when `resolutions` is empty or a width is invalid.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function toHLS(input: string, outputDir: string, options: HLSOptions): Promise<void> {
  await validateInput(input, VIDEO_INPUT_FORMATS);

  const { resolutions } = options;
  if (resolutions.length === 0) {
    throw new InvalidOptionsError('resolutions must contain at least one entry');
  }
  for (const r of resolutions) {
    if (!Number.isInteger(r.width) || r.width <= 0) {
      throw new InvalidOptionsError(`resolution width must be a positive integer (got ${r.width})`);
    }
  }

  const segmentDuration = options.segmentDuration ?? DEFAULT_SEGMENT_DURATION;
  const segmentType = options.segmentType ?? DEFAULT_SEGMENT_TYPE;

  // Probe once: gives the total duration (for progress) and whether audio exists.
  const info = await probe(input);
  const hasAudio = info.audio !== null;

  await mkdir(outputDir, { recursive: true });

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args: buildVideoHLSArgs(input, outputDir, resolutions, segmentDuration, hasAudio, segmentType),
    duration: info.duration,
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}

/**
 * Packages an audio file into adaptive-bitrate HLS: one AAC variant per
 * requested bitrate plus a `master.m3u8` playlist, written under `outputDir`.
 *
 * The audio-only counterpart of {@link toHLS} — a bitrate ladder instead of a
 * resolution ladder, no filtergraph. Layout: `outputDir/master.m3u8` + one
 * sub-folder per variant (named by its bitrate, e.g. `128k/`) containing
 * `playlist.m3u8` and its segments (`.ts` by default, or `.m4s` + an
 * `init.mp4` when `segmentType` is `'fmp4'`). A `master.m3u8` is written even
 * for a single bitrate.
 *
 * @param input - Path to the source audio file (MP3/AAC/WAV/FLAC/M4A).
 * @param outputDir - Directory to write the playlists and segments into (created if needed).
 * @param options - The bitrate ladder, segment duration/type and progress/abort options.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when `input` is not a supported audio format.
 * @throws {InvalidOptionsError} when `bitrates` is empty.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function audioToHLS(
  input: string,
  outputDir: string,
  options: AudioHLSOptions = {},
): Promise<void> {
  await validateInput(input, AUDIO_INPUT_FORMATS);

  const bitrates = options.bitrates ?? DEFAULT_AUDIO_BITRATES;
  if (bitrates.length === 0) {
    throw new InvalidOptionsError('bitrates must contain at least one entry');
  }

  const segmentDuration = options.segmentDuration ?? DEFAULT_SEGMENT_DURATION;
  const segmentType = options.segmentType ?? DEFAULT_SEGMENT_TYPE;

  // Probe once for the total duration (drives progress).
  const info = await probe(input);

  await mkdir(outputDir, { recursive: true });

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args: buildAudioHLSArgs(input, outputDir, bitrates, segmentDuration, segmentType),
    duration: info.duration,
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}
