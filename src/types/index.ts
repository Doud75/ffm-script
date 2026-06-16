export interface Stream {
  index: number;
  type: 'video' | 'audio' | 'subtitle' | 'data';
  codec: string;
}

export interface VideoStream extends Stream {
  type: 'video';
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  /** Display rotation in degrees clockwise, normalized to [0, 360). */
  rotation: number;
}

export interface AudioStream extends Stream {
  type: 'audio';
  sampleRate: number;
  channels: number;
  bitrate: number;
}

export interface ProbeResult {
  duration: number;
  size: number;
  bitrate: number;
  streams: Stream[];
  video: VideoStream | null;
  audio: AudioStream | null;
}

export interface ConvertOptions {
  videoCodec?: string;
  audioCodec?: string;
  videoBitrate?: string;
  audioBitrate?: string;
  width?: number;
  height?: number;
  onProgress?: (progress: Progress) => void;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

export interface TrimOptions {
  start: number | string;
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
  onProgress?: (progress: Progress) => void;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

export interface ExtractAudioOptions {
  codec?: 'mp3' | 'aac';
  bitrate?: string;
  sampleRate?: number;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

export interface ThumbnailOptions {
  timestamp: number | string;
  width?: number;
  /** Aborts the operation; the returned promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

export interface Progress {
  percent: number;
  currentTime: number;
  totalTime: number;
}
