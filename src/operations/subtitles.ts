import { extname } from 'node:path';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { validateInput } from '../core/validate.js';
import { VIDEO_INPUT_FORMATS, SUBTITLE_FORMATS } from '../core/formats.js';
import { buildSubtitlesFilter } from '../core/subtitles.js';
import { InvalidFormatError, InvalidOptionsError } from '../errors/index.js';
import type { BurnSubtitlesOptions, ExtractSubtitlesOptions } from '../types/index.js';
import { probe } from './probe.js';

/** Counts the subtitle streams in a media file. */
async function countSubtitleStreams(input: string): Promise<number> {
  const info = await probe(input);
  return info.streams.filter((s) => s.type === 'subtitle').length;
}

function assertTrack(track: number): void {
  if (!Number.isInteger(track) || track < 0) {
    throw new InvalidOptionsError(`track must be a non-negative integer (got ${track})`);
  }
}

/**
 * Extracts a subtitle track from a video into a standalone subtitle file. The
 * format is taken from the output extension (`.srt`, `.vtt` or `.ass`), and
 * FFmpeg converts the embedded codec to it (e.g. MP4 `mov_text` → SubRip).
 *
 * @param input - Path to the source video (MP4/MOV/WebM/MKV).
 * @param output - Path to the destination subtitle file (`.srt`, `.vtt` or `.ass`).
 * @param options - Which subtitle track to extract, and abort options.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when `input`/`output` is not a supported format, or the input has no subtitle track.
 * @throws {InvalidOptionsError} when `track` is not a non-negative integer or is out of range.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function extractSubtitles(
  input: string,
  output: string,
  options: ExtractSubtitlesOptions = {},
): Promise<void> {
  await validateInput(input, VIDEO_INPUT_FORMATS);

  const ext = extname(output).toLowerCase();
  if (!SUBTITLE_FORMATS.includes(ext)) {
    throw new InvalidFormatError(
      output,
      `unsupported subtitle extension "${ext || '(none)'}" (expected ${SUBTITLE_FORMATS.join(', ')})`,
    );
  }

  const track = options.track ?? 0;
  assertTrack(track);

  const subtitleCount = await countSubtitleStreams(input);
  if (subtitleCount === 0) {
    throw new InvalidFormatError(input, 'input has no subtitle track to extract');
  }
  if (track >= subtitleCount) {
    throw new InvalidOptionsError(
      `subtitle track ${track} does not exist (input has ${subtitleCount})`,
    );
  }

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args: ['-i', input, '-map', `0:s:${track}`, '-y', output],
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}

/**
 * Burns subtitles permanently into the picture (hardcoded), writing an MP4. The
 * subtitles come from an external file (`options.subtitles`) or, when none is
 * given, from an embedded `track` of the input. The video is re-encoded
 * (`libx264`) since the picture changes; the audio is stream-copied unchanged.
 *
 * @param input - Path to the source video (MP4/MOV/WebM/MKV).
 * @param output - Path to the destination `.mp4` file (overwritten if present).
 * @param options - External subtitle file or embedded track, plus progress/abort options.
 * @throws {FileNotFoundError} when `input` or the external subtitle file does not exist.
 * @throws {InvalidFormatError} when a format is unsupported, `output` is not `.mp4`, or no embedded subtitle track exists.
 * @throws {InvalidOptionsError} when `track` is not a non-negative integer or is out of range.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function burnSubtitles(
  input: string,
  output: string,
  options: BurnSubtitlesOptions = {},
): Promise<void> {
  await validateInput(input, VIDEO_INPUT_FORMATS);
  if (extname(output).toLowerCase() !== '.mp4') {
    throw new InvalidFormatError(output, 'output must be an .mp4 file');
  }

  let filter: string;
  if (options.subtitles !== undefined) {
    await validateInput(options.subtitles, SUBTITLE_FORMATS);
    filter = buildSubtitlesFilter(options.subtitles);
  } else {
    const track = options.track ?? 0;
    assertTrack(track);
    const subtitleCount = await countSubtitleStreams(input);
    if (subtitleCount === 0) {
      throw new InvalidFormatError(
        input,
        'input has no subtitle track to burn (pass options.subtitles for an external file)',
      );
    }
    if (track >= subtitleCount) {
      throw new InvalidOptionsError(
        `subtitle track ${track} does not exist (input has ${subtitleCount})`,
      );
    }
    // The subtitles filter reads the embedded track straight from the input file.
    filter = buildSubtitlesFilter(input, track);
  }

  const duration =
    options.onProgress !== undefined ? (await probe(input)).duration : undefined;

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args: ['-i', input, '-vf', filter, '-c:v', 'libx264', '-c:a', 'copy', '-y', output],
    ...(duration !== undefined ? { duration } : {}),
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}
