/** A single media stream within a file. */
export interface Stream {
  /** Zero-based position of the stream in the container. */
  index: number;
  /** Kind of data the stream carries. */
  type: 'video' | 'audio' | 'subtitle' | 'data';
  /** Codec short name as reported by ffprobe (e.g. `'h264'`, `'aac'`). */
  codec: string;
}

/** A video stream with its picture properties. */
export interface VideoStream extends Stream {
  type: 'video';
  /** Frame width in pixels. */
  width: number;
  /** Frame height in pixels. */
  height: number;
  /** Frames per second (average frame rate). */
  fps: number;
  /** Stream bitrate in bits per second (`0` when unknown). */
  bitrate: number;
  /** Display rotation in degrees clockwise, normalized to [0, 360). */
  rotation: number;
}

/** An audio stream with its sound properties. */
export interface AudioStream extends Stream {
  type: 'audio';
  /** Sampling rate in Hz (e.g. `48000`). */
  sampleRate: number;
  /** Number of audio channels (e.g. `2` for stereo). */
  channels: number;
  /** Stream bitrate in bits per second (`0` when unknown). */
  bitrate: number;
}

/** Metadata returned by {@link probe}. */
export interface ProbeResult {
  /** Total duration in seconds. */
  duration: number;
  /** File size in bytes. */
  size: number;
  /** Overall bitrate in bits per second. */
  bitrate: number;
  /** Every stream found in the file, in container order. */
  streams: Stream[];
  /** The first video stream, or `null` when there is none. */
  video: VideoStream | null;
  /** The first audio stream, or `null` when there is none. */
  audio: AudioStream | null;
}

/**
 * Semantic video quality preset (libx264 CRF + speed preset):
 * - `'high'`     — visually lossless, larger files (`-crf 18 -preset slow`).
 * - `'balanced'` — sensible default trade-off (`-crf 23 -preset medium`).
 * - `'small'`    — smaller files, lower quality (`-crf 28 -preset medium`).
 *
 * Mutually exclusive with an explicit video bitrate (CRF targets a quality,
 * a bitrate targets a size).
 */
export type Quality = 'high' | 'balanced' | 'small';

/** Options for {@link convert}. All fields are optional; sensible defaults apply. */
export interface ConvertOptions {
  /** Video codec / encoder (FFmpeg `-c:v`). Defaults to `'libx264'`. */
  videoCodec?: string;
  /** Semantic quality preset (CRF + speed). Mutually exclusive with `videoBitrate`. */
  quality?: Quality;
  /** Audio codec / encoder (FFmpeg `-c:a`). Defaults to `'aac'`. */
  audioCodec?: string;
  /** Target video bitrate, e.g. `'2M'` or `'2500k'` (FFmpeg `-b:v`). */
  videoBitrate?: string;
  /** Target audio bitrate, e.g. `'192k'` (FFmpeg `-b:a`). */
  audioBitrate?: string;
  /** Output width in pixels. If only one dimension is set, aspect ratio is preserved. */
  width?: number;
  /** Output height in pixels. If only one dimension is set, aspect ratio is preserved. */
  height?: number;
  /** Called with progress updates as the transcode advances. */
  onProgress?: (progress: Progress) => void;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/** Options for {@link trim}. */
export interface TrimOptions {
  /** Start of the cut, in seconds or as an `HH:MM:SS[.ms]` string. */
  start: number | string;
  /** End of the cut, in seconds or as an `HH:MM:SS[.ms]` string. Must be after `start`. */
  end: number | string;
  /**
   * 'fast'    — seeks to the nearest keyframe before cutting (no re-encode, may be off by up to
   *             a few seconds depending on GOP size).
   * 'precise' — re-encodes from the seek point so the cut lands on the exact timestamp
   *             (frame-accurate but significantly slower).
   *
   * Defaults to 'fast'.
   */
  mode?: 'fast' | 'precise';
  /** Called with progress updates as the cut advances. */
  onProgress?: (progress: Progress) => void;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/** Options for {@link extractAudio}. */
export interface ExtractAudioOptions {
  /** Output audio codec. Inferred from the output extension when omitted. */
  codec?: 'mp3' | 'aac';
  /** Target audio bitrate, e.g. `'320k'` (FFmpeg `-b:a`). */
  bitrate?: string;
  /** Output sample rate in Hz, e.g. `44100` (FFmpeg `-ar`). */
  sampleRate?: number;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/** Options for {@link thumbnail}. */
export interface ThumbnailOptions {
  /** Frame to capture, in seconds or as an `HH:MM:SS[.ms]` string. */
  timestamp: number | string;
  /** Output width in pixels; height is scaled to preserve the aspect ratio. */
  width?: number;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/** A single quality variant in an HLS adaptive-bitrate ladder. */
export interface HLSResolution {
  /** Output width in pixels; height is scaled to preserve the aspect ratio. */
  width: number;
  /** Target video bitrate for this variant, e.g. `'2500k'`. */
  bitrate: string;
  /** Variant sub-folder name under the output directory; defaults to the width. */
  name?: string;
}

/** Options for {@link toHLS}. */
export interface HLSOptions {
  /** One entry per quality variant (the adaptive-bitrate ladder). */
  resolutions: HLSResolution[];
  /** Segment length in seconds. Defaults to `6`. */
  segmentDuration?: number;
  /** Called with progress updates as the packaging advances. */
  onProgress?: (progress: Progress) => void;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/** A keyframe (sync sample) position, in seconds from the start. */
export interface Keyframe {
  timestamp: number;
}

/** Options for {@link parallelConvert}. */
export interface ParallelConvertOptions {
  /**
   * Number of parallel FFmpeg workers. Defaults to half the host's logical CPU
   * cores (at least 1), leaving the machine usable during the transcode. A value
   * larger than the core count is capped to it to avoid oversubscribing the CPU.
   */
  workers?: number;
  /** Target video bitrate, e.g. `'2000k'` (FFmpeg `-b:v`). Mutually exclusive with `quality`. */
  targetBitrate?: string;
  /** Semantic quality preset (CRF + speed). Mutually exclusive with `targetBitrate`. */
  quality?: Quality;
  /** Output width in pixels. If only one dimension is set, aspect ratio is preserved. */
  width?: number;
  /** Output height in pixels. If only one dimension is set, aspect ratio is preserved. */
  height?: number;
  /** Called with aggregated progress across all workers. */
  onProgress?: (progress: Progress) => void;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/** Where a watermark is anchored within the frame. */
export type OverlayPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center';

/** Options for {@link overlay}. */
export interface OverlayOptions {
  /** Path to the overlay image (PNG, JPEG or WebP). */
  watermark: string;
  /** Corner (or centre) the watermark is anchored to. Defaults to `'bottom-right'`. */
  position?: OverlayPosition;
  /** Gap in pixels between the watermark and the frame edges. Ignored for `'center'`. Defaults to `10`. */
  margin?: number;
  /** Watermark opacity in [0, 1]. Defaults to `1` (fully opaque). */
  opacity?: number;
  /** Scale the watermark to this width in pixels (height preserves aspect ratio). Omitted → native size. */
  width?: number;
  /** Called with progress updates as the overlay advances. */
  onProgress?: (progress: Progress) => void;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/** Options for {@link concat}. */
export interface ConcatOptions {
  /**
   * How the files are joined:
   * - 'fast'    — concat demuxer with stream copy (no re-encode). Fast, but every
   *               input must share the same codecs and parameters or the output is
   *               corrupt.
   * - 'precise' — concat filter, re-encoding the output. Handles heterogeneous
   *               inputs (different codecs/resolutions) at the cost of speed.
   * - 'auto'    — probes the inputs and picks 'fast' when they are compatible,
   *               'precise' otherwise.
   *
   * Defaults to 'auto'.
   */
  mode?: 'fast' | 'precise' | 'auto';
  /** Called with progress updates as the join advances. */
  onProgress?: (progress: Progress) => void;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/** Options for {@link run}, the raw FFmpeg escape hatch. */
export interface RunOptions {
  /**
   * Total media duration in seconds, used to turn FFmpeg's `time=` output into a
   * percentage. The input is **not** auto-probed: in a free-form argument list
   * there is no reliable way to tell which token is the input. Omit it and no
   * progress events are emitted (the run still works); provide it to get `percent`.
   */
  duration?: number;
  /** Called with progress updates as the run advances. Requires `duration`. */
  onProgress?: (progress: Progress) => void;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
  /** Max run time in milliseconds; on overrun the process is killed (`FFmpegTimeoutError`). */
  timeout?: number;
}

/** Progress information reported through an `onProgress` callback. */
export interface Progress {
  /** Completion percentage, clamped to [0, 100]. */
  percent: number;
  /** Timestamp currently being processed, in seconds. */
  currentTime: number;
  /** Total duration being processed, in seconds. */
  totalTime: number;
}
