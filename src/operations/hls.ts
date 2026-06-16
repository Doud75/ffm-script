import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { validateInput } from '../core/validate.js';
import { VIDEO_INPUT_FORMATS } from '../core/formats.js';
import { InvalidOptionsError } from '../errors/index.js';
import type { HLSOptions, HLSResolution } from '../types/index.js';
import { probe } from './probe.js';

const DEFAULT_SEGMENT_DURATION = 6;
const AUDIO_BITRATE = '128k';

/**
 * Packages a video file into adaptive-bitrate HLS: one variant per requested
 * resolution plus a `master.m3u8` playlist, written under `outputDir`.
 *
 * Layout: `outputDir/master.m3u8` + one sub-folder per variant (named by its
 * width, or by `resolution.name`) containing `playlist.m3u8` and `.ts` segments.
 *
 * @param input - Path to the source video file (MP4/MOV/WebM/MKV).
 * @param outputDir - Directory to write the playlists and segments into (created if needed).
 * @param options - The resolution ladder, segment duration and progress/abort options.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when `input` is not a supported video format.
 * @throws {InvalidOptionsError} when `resolutions` is empty or a width is invalid.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function toHLS(
  input: string,
  outputDir: string,
  options: HLSOptions,
): Promise<void> {
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

  // Probe once: gives the total duration (for progress) and whether audio exists.
  const info = await probe(input);
  const hasAudio = info.audio !== null;

  await mkdir(outputDir, { recursive: true });

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args: buildArgs(input, outputDir, resolutions, segmentDuration, hasAudio),
    duration: info.duration,
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}

function buildArgs(
  input: string,
  outputDir: string,
  resolutions: HLSResolution[],
  segmentDuration: number,
  hasAudio: boolean,
): string[] {
  // Split the source video into N streams and scale each to a target width.
  const split = `[0:v]split=${resolutions.length}${resolutions.map((_, i) => `[v${i}]`).join('')}`;
  const scales = resolutions.map((r, i) => `[v${i}]scale=w=${r.width}:h=-2[v${i}out]`);
  const filterComplex = [split, ...scales].join('; ');

  const args = ['-i', input, '-filter_complex', filterComplex];

  resolutions.forEach((r, i) => {
    args.push('-map', `[v${i}out]`, `-c:v:${i}`, 'libx264', `-b:v:${i}`, r.bitrate);
  });
  if (hasAudio) {
    resolutions.forEach((_, i) => {
      args.push('-map', 'a:0', `-c:a:${i}`, 'aac', `-b:a:${i}`, AUDIO_BITRATE);
    });
  }

  const varStreamMap = resolutions
    .map((r, i) => {
      const name = r.name ?? String(r.width);
      return hasAudio ? `v:${i},a:${i},name:${name}` : `v:${i},name:${name}`;
    })
    .join(' ');

  args.push(
    '-f', 'hls',
    '-hls_time', String(segmentDuration),
    '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', join(outputDir, '%v', 'segment_%03d.ts'),
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', varStreamMap,
    '-y',
    join(outputDir, '%v', 'playlist.m3u8'),
  );

  return args;
}
