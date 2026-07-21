export { checkDependencies } from './core/binary.js';
export { probe } from './operations/probe.js';
export { convert } from './operations/convert.js';
export { trim } from './operations/trim.js';
export { extractAudio } from './operations/extract.js';
export { thumbnail } from './operations/thumbnail.js';
export { overlay } from './operations/overlay.js';
export { extractSubtitles, burnSubtitles } from './operations/subtitles.js';
export { toAnimation } from './operations/animation.js';
export { setMetadata } from './operations/metadata.js';
export { run, runStream } from './operations/run.js';
export { concat } from './operations/concat.js';
export { toHLS, audioToHLS } from './operations/hls.js';
export { ffmscript, FfmScriptChain } from './operations/chain.js';
export type { SaveOptions } from './operations/chain.js';
export { parallelConvert } from './operations/parallel.js';
export { extractKeyframeIndex } from './core/mp4.js';
export { resolveKeyframes } from './core/keyframes.js';
export { planSegments } from './core/segments.js';
export type { Segment, SegmentExecutor, SegmentExecutorContext } from './core/segments.js';
export type {
  Stream,
  VideoStream,
  AudioStream,
  ProbeResult,
  Quality,
  ConvertOptions,
  TrimOptions,
  ExtractAudioOptions,
  ThumbnailOptions,
  HLSResolution,
  HLSOptions,
  AudioHLSOptions,
  SegmentType,
  Keyframe,
  ParallelConvertOptions,
  OverlayPosition,
  OverlayOptions,
  AnimationOptions,
  ExtractSubtitlesOptions,
  BurnSubtitlesOptions,
  ConcatOptions,
  RunOptions,
  RunStreamOptions,
  SetMetadataOptions,
  Progress,
} from './types/index.js';
export {
  FfmScriptError,
  FFmpegNotFoundError,
  FileNotFoundError,
  InvalidFormatError,
  InvalidOptionsError,
  FFmpegError,
  FFmpegTimeoutError,
} from './errors/index.js';
