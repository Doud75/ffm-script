import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { validateInput } from '../core/validate.js';
import { InvalidFormatError } from '../errors/index.js';
import type {
  AudioStream,
  ProbeResult,
  Stream,
  VideoStream,
} from '../types/index.js';

/** Shape of the relevant subset of `ffprobe -print_format json` output. */
interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

interface FfprobeStream {
  index?: number;
  codec_name?: string;
  codec_type?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

interface FfprobeFormat {
  duration?: string;
  size?: string;
  bit_rate?: string;
}

/**
 * Reads media metadata from a file using `ffprobe`.
 *
 * Guaranteed input format in v0.1: MP4.
 *
 * @param file - Path to the input MP4 file.
 * @returns Duration, size, bitrate, the list of streams, and the primary
 * video/audio streams (or `null` when absent).
 * @throws {FileNotFoundError} when the file does not exist.
 * @throws {InvalidFormatError} when the extension is not `.mp4` or ffprobe
 * returns unparseable output.
 * @throws {FFmpegNotFoundError} when `ffprobe` cannot be located.
 * @throws {FFmpegError} when `ffprobe` exits with a non-zero code.
 */
export async function probe(file: string): Promise<ProbeResult> {
  await validateInput(file, ['.mp4']);

  const stdout = await spawnFFmpeg({
    binary: resolveBinary('ffprobe'),
    args: [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      file,
    ],
  });

  return parseProbeOutput(file, stdout);
}

/**
 * Maps raw `ffprobe` JSON output to a {@link ProbeResult}. Pure (no I/O), so it
 * is unit-tested directly against synthetic ffprobe payloads.
 *
 * @throws {InvalidFormatError} when `stdout` is not valid JSON.
 */
export function parseProbeOutput(file: string, stdout: string): ProbeResult {
  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    throw new InvalidFormatError(file, 'ffprobe returned no parseable metadata');
  }

  const ffStreams = parsed.streams ?? [];
  const video = ffStreams.find((s) => s.codec_type === 'video');
  const audio = ffStreams.find((s) => s.codec_type === 'audio');

  return {
    duration: toNumber(parsed.format?.duration),
    size: toNumber(parsed.format?.size),
    bitrate: toNumber(parsed.format?.bit_rate),
    streams: ffStreams.map(toStream),
    video: video !== undefined ? toVideoStream(video) : null,
    audio: audio !== undefined ? toAudioStream(audio) : null,
  };
}

function toStream(stream: FfprobeStream): Stream {
  return {
    index: toNumber(stream.index),
    type: toStreamType(stream.codec_type),
    codec: stream.codec_name ?? '',
  };
}

function toVideoStream(stream: FfprobeStream): VideoStream {
  return {
    index: toNumber(stream.index),
    type: 'video',
    codec: stream.codec_name ?? '',
    width: toNumber(stream.width),
    height: toNumber(stream.height),
    fps: toFps(stream.avg_frame_rate ?? stream.r_frame_rate),
    bitrate: toNumber(stream.bit_rate),
    rotation: toRotation(stream),
  };
}

function toAudioStream(stream: FfprobeStream): AudioStream {
  return {
    index: toNumber(stream.index),
    type: 'audio',
    codec: stream.codec_name ?? '',
    sampleRate: toNumber(stream.sample_rate),
    channels: toNumber(stream.channels),
    bitrate: toNumber(stream.bit_rate),
  };
}

function toStreamType(codecType: string | undefined): Stream['type'] {
  switch (codecType) {
    case 'video':
    case 'audio':
    case 'subtitle':
      return codecType;
    default:
      return 'data';
  }
}

/** Parses a `"num/den"` rational (e.g. ffprobe frame rates) into a number. */
function toFps(rate: string | undefined): number {
  if (rate === undefined) return 0;
  const [num, den] = rate.split('/');
  const numerator = toNumber(num);
  const denominator = den === undefined ? 1 : toNumber(den);
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Resolves display rotation from the Display Matrix side data (preferred) or
 * the legacy `rotate` tag, normalized to degrees clockwise in [0, 360).
 */
function toRotation(stream: FfprobeStream): number {
  const sideData = stream.side_data_list?.find((d) => d.rotation !== undefined);
  const raw =
    sideData?.rotation ??
    (stream.tags?.rotate !== undefined ? toNumber(stream.tags.rotate) : 0);
  return ((Math.round(raw) % 360) + 360) % 360;
}

/** Coerces a possibly-undefined string/number to a finite number, else 0. */
function toNumber(value: string | number | undefined): number {
  if (value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
