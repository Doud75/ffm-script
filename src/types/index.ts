import type { Readable, Writable } from 'node:stream';
import type { SegmentExecutor } from '../core/segments.js';

/** A single media stream within a file. */
export interface Stream {
  /** Zero-based position of the stream in the container. */
  index: number;
  /** Kind of data the stream carries. */
  type: 'video' | 'audio' | 'subtitle' | 'data';
  /** Codec short name as reported by ffprobe (e.g. `'h264'`, `'aac'`). */
  codec: string;
  /**
   * Per-stream metadata tags as reported by ffprobe (e.g. `language`, `title`,
   * `handler_name`). Empty when the stream carries none.
   */
  tags: Record<string, string>;
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
  /**
   * Container-level metadata tags as reported by ffprobe (e.g. `title`, `artist`,
   * `album`, `comment`, `creation_time`). Empty when the file carries none. Write
   * these back with {@link setMetadata}.
   */
  tags: Record<string, string>;
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

/** HLS segment container: `'ts'` (MPEG-TS) or `'fmp4'` (fragmented MP4 / CMAF). */
export type SegmentType = 'ts' | 'fmp4';

/** Options for {@link toHLS}. */
export interface HLSOptions {
  /** One entry per quality variant (the adaptive-bitrate ladder). */
  resolutions: HLSResolution[];
  /** Segment length in seconds. Defaults to `6`. */
  segmentDuration?: number;
  /**
   * Segment container. `'ts'` (MPEG-TS, the default) or `'fmp4'` (fragmented
   * MP4 / CMAF: `.m4s` segments plus an `init.mp4` per variant), for modern /
   * low-latency HLS players.
   */
  segmentType?: SegmentType;
  /** Called with progress updates as the packaging advances. */
  onProgress?: (progress: Progress) => void;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/** Options for {@link audioToHLS}. */
export interface AudioHLSOptions {
  /**
   * Audio-only ABR ladder: one AAC variant per entry, e.g. `['128k', '64k']`.
   * Defaults to `['128k']`. The variant sub-folder is named after the bitrate.
   */
  bitrates?: string[];
  /** Segment length in seconds. Defaults to `6`. */
  segmentDuration?: number;
  /**
   * Segment container. `'ts'` (MPEG-TS, the default) or `'fmp4'` (fragmented
   * MP4 / CMAF: `.m4s` segments plus an `init.mp4` per variant), for modern /
   * low-latency HLS players.
   */
  segmentType?: SegmentType;
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
  videoBitrate?: string;
  /** Semantic quality preset (CRF + speed). Mutually exclusive with `videoBitrate`. */
  quality?: Quality;
  /** Output width in pixels. If only one dimension is set, aspect ratio is preserved. */
  width?: number;
  /** Output height in pixels. If only one dimension is set, aspect ratio is preserved. */
  height?: number;
  /**
   * Custom per-segment encoder. Omitted → each chunk is encoded by a local FFmpeg
   * process (the default). Supply one to distribute the chunk encodes across
   * machines: `parallelConvert` still plans the keyframe split, encodes the audio
   * in one continuous pass and joins the chunks — it just calls this to produce
   * each video chunk instead of spawning FFmpeg locally. See {@link SegmentExecutor}.
   */
  executor?: SegmentExecutor;
  /**
   * How many segments to encode concurrently, and how finely the timeline is split.
   * Only meaningful with a custom `executor`, where it replaces the core-based
   * default and is **not** capped to the host's core count (remote workers aren't
   * bound by this machine's CPU). Without an `executor`, local parallelism follows
   * `workers` and this is ignored.
   */
  concurrency?: number;
  /**
   * How many times to re-attempt a segment whose encode fails before giving up.
   * Defaults to `0` (a single attempt — the failure propagates immediately). Meant
   * for distributed runs, where a remote worker can die mid-encode: each retry
   * calls the `executor` again for that segment, so a retrying executor can route
   * it to another worker. An aborted run is **never** retried.
   */
  retries?: number;
  /**
   * Milliseconds to wait between a failed attempt and the next retry. Defaults to
   * `0` (retry immediately). Only applies when `retries` is set; the wait is
   * interrupted by `signal`.
   */
  retryDelay?: number;
  /** Called with aggregated progress across all workers. */
  onProgress?: (progress: Progress) => void;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/** Options for {@link processBatch}. */
export interface BatchOptions {
  /**
   * How many tasks run at once. Defaults to half the host's logical cores (at
   * least 1) — the sensible default when each task is itself an FFmpeg process
   * that already saturates the CPU. Not capped, so raise it for I/O-bound tasks.
   */
  concurrency?: number;
  /**
   * Called after each task finishes, with the number of completed tasks and the
   * total. A plain `(done, total)` counter — not the FFmpeg `Progress` object —
   * since a batch tracks *files done*, not a single timeline.
   */
  onProgress?: (done: number, total: number) => void;
  /**
   * Stops the pool from starting further tasks; the returned promise rejects with
   * an `AbortError`. Tasks already running are not cancelled — wire this same
   * signal into your `task` if you need to stop them mid-flight.
   */
  signal?: AbortSignal;
}

/** Where a watermark is anchored within the frame. */
export type OverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

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

/** Options for {@link toAnimation}. */
export interface AnimationOptions {
  /** Start of the clip, in seconds or `HH:MM:SS[.ms]`. Defaults to `0` (start of the input). */
  start?: number | string;
  /** End of the clip, in seconds or `HH:MM:SS[.ms]`. Defaults to the end of the input. Must be after `start`. */
  end?: number | string;
  /** Output frame rate. Defaults to `15`. */
  fps?: number;
  /** Output width in pixels; height preserves the aspect ratio. Omitted → source width. */
  width?: number;
  /** Loop count: `0` loops forever (default), `-1` plays once. */
  loop?: number;
  /** Called with progress updates as the encode advances. */
  onProgress?: (progress: Progress) => void;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/** Options for {@link extractSubtitles}. */
export interface ExtractSubtitlesOptions {
  /** Which subtitle track to extract, 0-based among the input's subtitle streams. Defaults to `0`. */
  track?: number;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/** Options for {@link burnSubtitles}. */
export interface BurnSubtitlesOptions {
  /**
   * Path to an external subtitle file (`.srt`, `.vtt` or `.ass`) to burn in.
   * When omitted, the embedded subtitle `track` of the input is rendered instead.
   */
  subtitles?: string;
  /**
   * Which embedded subtitle track to burn, 0-based among the input's subtitle
   * streams. Ignored when an external `subtitles` file is given. Defaults to `0`.
   */
  track?: number;
  /** Called with progress updates as the burn-in advances. */
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

/**
 * Options for {@link runStream}, the streaming raw FFmpeg escape hatch.
 *
 * Data flows straight through the process without being buffered in memory, so
 * the footprint stays bounded whatever the file size. Because a pipe is **not
 * seekable**, the args must use a streamable format: a streamable container
 * (MPEG-TS, Matroska) or fragmented MP4 (`-movflags frag_keyframe+empty_moov`)
 * for piped output, and a linearly-decodable input for piped input.
 */
export interface RunStreamOptions {
  /**
   * Source piped into FFmpeg's stdin. Reference it in `args` as `pipe:0` (or `-`),
   * e.g. `['-i', 'pipe:0', …]`. Omit to read from a file path in `args` instead.
   */
  input?: Readable;
  /**
   * Sink FFmpeg's stdout is piped into. Reference it in `args` as `pipe:1`,
   * e.g. `[…, 'pipe:1']`. Omit to write to a file path in `args` instead.
   */
  output?: Writable;
  /**
   * Total media duration in seconds, used to turn FFmpeg's `time=` output into a
   * percentage. The input is **not** auto-probed (a stream can't be re-read).
   * Omit it and no progress events are emitted; provide it to get `percent`.
   */
  duration?: number;
  /** Called with progress updates as the run advances. Requires `duration`. */
  onProgress?: (progress: Progress) => void;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
  /** Max run time in milliseconds; on overrun the process is killed (`FFmpegTimeoutError`). */
  timeout?: number;
}

/** Options for {@link setMetadata}. */
export interface SetMetadataOptions {
  /**
   * Tags to write, as `key: value` pairs (e.g. `{ title: 'My Movie', artist: 'Me' }`).
   * Keys are FFmpeg metadata keys (`title`, `artist`, `album`, `comment`,
   * `copyright`, `creation_time`, …). They are layered on top of the input's
   * existing tags, unless `clear` is set — then they are the only tags kept.
   */
  tags?: Record<string, string>;
  /**
   * Drop every existing tag from the input before writing `tags` (FFmpeg
   * `-map_metadata -1`). With no `tags`, this strips all metadata — useful to
   * anonymise a file. Defaults to `false`.
   */
  clear?: boolean;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/** Progress information reported through an `onProgress` callback. */
export interface Progress {
  /** Completion percentage, clamped to [0, 100]. */
  percent: number;
  /** Timestamp currently being processed, in seconds. */
  currentTime: number;
  /** Total duration being processed, in seconds. */
  totalTime: number;
  /** Encoding rate in frames per second, when FFmpeg reports it. */
  fps?: number;
  /** Encoding speed as a multiple of realtime (e.g. `1.5` = 1.5×), when reported. */
  speed?: number;
  /** Output bitrate in bits per second, when reported. */
  bitrate?: number;
  /**
   * Estimated seconds remaining, derived from `speed` and the remaining
   * duration. Present only when a positive `speed` is known.
   */
  eta?: number;
}
