import { extname } from 'node:path';
import { InvalidFormatError } from '../errors/index.js';

/** A supported video output container. */
export type VideoContainer = 'mp4' | 'mov' | 'mkv' | 'webm';

/** Either an explicit allow-list of codec short names, or `'any'` (Matroska). */
type CodecList = readonly string[] | 'any';

/** Per-container muxing rules: accepted extensions, default and allowed codecs. */
export interface ContainerConfig {
  /** Output extensions that select this container. */
  extensions: readonly string[];
  /** FFmpeg `-c:v` encoder used when the caller doesn't pass `videoCodec`. */
  defaultVideoCodec: string;
  /** FFmpeg `-c:a` encoder used when the caller doesn't pass `audioCodec`. */
  defaultAudioCodec: string;
  /** Video codec short names this container accepts (`'any'` for Matroska). */
  videoCodecs: CodecList;
  /** Audio codec short names this container accepts (`'any'` for Matroska). */
  audioCodecs: CodecList;
  /** Extra `-c:v` arguments injected with the default video codec (e.g. VP9 speed). */
  defaultVideoCodecArgs?: readonly string[];
}

const H264_CONTAINER = {
  defaultVideoCodec: 'libx264',
  defaultAudioCodec: 'aac',
  videoCodecs: ['h264', 'h265', 'av1', 'mpeg4'],
  audioCodecs: ['aac', 'mp3', 'ac3'],
} as const;

/** The container → muxing-rules matrix. */
const CONTAINERS: Record<VideoContainer, ContainerConfig> = {
  mp4: { extensions: ['.mp4'], ...H264_CONTAINER },
  mov: { extensions: ['.mov'], ...H264_CONTAINER },
  // Matroska is a near-universal container: accept whatever codec the caller picks.
  mkv: {
    extensions: ['.mkv'],
    defaultVideoCodec: 'libx264',
    defaultAudioCodec: 'aac',
    videoCodecs: 'any',
    audioCodecs: 'any',
  },
  webm: {
    extensions: ['.webm'],
    defaultVideoCodec: 'libvpx-vp9',
    defaultAudioCodec: 'libopus',
    videoCodecs: ['vp8', 'vp9', 'av1'],
    audioCodecs: ['opus', 'vorbis'],
    // libvpx-vp9 is single-threaded and slow by default; these keep transcodes
    // usable without aggressive quality tuning. Only applied with the default codec.
    defaultVideoCodecArgs: ['-deadline', 'good', '-cpu-used', '4', '-row-mt', '1'],
  },
};

/**
 * Maps a known FFmpeg encoder (or codec name) to its codec short name, so an
 * explicit `videoCodec`/`audioCodec` can be checked against a container. Encoders
 * not listed here are intentionally absent: we defer them to FFmpeg rather than
 * risk a false rejection of a valid platform encoder (e.g. `h264_videotoolbox`).
 */
const ENCODER_TO_CODEC: Record<string, string> = {
  // video
  libx264: 'h264',
  h264: 'h264',
  libx265: 'h265',
  hevc: 'h265',
  h265: 'h265',
  'libvpx-vp9': 'vp9',
  vp9: 'vp9',
  libvpx: 'vp8',
  vp8: 'vp8',
  'libaom-av1': 'av1',
  libsvtav1: 'av1',
  av1: 'av1',
  mpeg4: 'mpeg4',
  // audio
  aac: 'aac',
  libopus: 'opus',
  opus: 'opus',
  libvorbis: 'vorbis',
  vorbis: 'vorbis',
  libmp3lame: 'mp3',
  mp3: 'mp3',
  ac3: 'ac3',
};

/** x264/x265-family encoders — the only ones the CRF `quality` presets fit. */
const CRF_FAMILY = new Set(['libx264', 'h264', 'libx265', 'hevc', 'h265', 'libx264rgb']);

/**
 * Resolves the output container from a file path's extension.
 *
 * @throws {InvalidFormatError} when the extension matches no supported container.
 */
export function resolveOutputContainer(output: string): {
  container: VideoContainer;
  config: ContainerConfig;
} {
  const ext = extname(output).toLowerCase();
  for (const container of Object.keys(CONTAINERS) as VideoContainer[]) {
    if (CONTAINERS[container].extensions.includes(ext)) {
      return { container, config: CONTAINERS[container] };
    }
  }
  const supported = (Object.keys(CONTAINERS) as VideoContainer[])
    .flatMap((c) => CONTAINERS[c].extensions)
    .join(', ');
  throw new InvalidFormatError(
    output,
    `unsupported output container "${ext || '(none)'}" (expected ${supported})`,
  );
}

/**
 * Validates that an encoder is compatible with a container. Only *known* encoders
 * (see {@link ENCODER_TO_CODEC}) are checked; unknown ones are deferred to FFmpeg.
 * Containers with `'any'` (Matroska) accept everything.
 *
 * @throws {InvalidFormatError} when a known encoder's codec isn't allowed.
 */
export function assertCodecAllowed(
  config: ContainerConfig,
  encoder: string,
  kind: 'video' | 'audio',
  output: string,
): void {
  const allowed = kind === 'video' ? config.videoCodecs : config.audioCodecs;
  if (allowed === 'any') return;

  const codec = ENCODER_TO_CODEC[encoder];
  if (codec === undefined) return; // unknown encoder → let FFmpeg decide

  if (!allowed.includes(codec)) {
    throw new InvalidFormatError(
      output,
      `${kind} codec "${codec}" is not valid in this container (accepts: ${allowed.join(', ')})`,
    );
  }
}

/** Whether `encoder` belongs to the x264/x265 family the `quality` presets target. */
export function isCrfFamily(encoder: string): boolean {
  return CRF_FAMILY.has(encoder);
}
