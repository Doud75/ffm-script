# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Additional input formats: video operations now accept MOV, WebM and MKV in addition to MP4; `probe` and `extractAudio` also accept audio-only inputs (MP3, AAC, WAV, FLAC, M4A). Video output remains MP4.
- `toHLS(input, outputDir, options)`: package a video into adaptive-bitrate HLS — a `master.m3u8` plus one variant folder (playlist + `.ts` segments) per requested resolution, with configurable segment duration and progress/abort support.

## [0.1.1] - 2026-06-16

### Changed

- Releases are now automated via GitHub Actions and npm Trusted Publishing (OIDC), with build provenance. No changes to the published API.

## [0.1.0] - 2026-06-16

Initial release. Guaranteed format: MP4 in and out.

### Added

- `probe(file)` — read media metadata (duration, size, bitrate, streams, video/audio details, rotation) via ffprobe.
- `convert(input, output, options)` — MP4 → MP4 transcode with codec, bitrate and resolution options (defaults: `libx264` / `aac`).
- `trim(input, output, options)` — cut a section with `fast` (stream copy, keyframe-bound) or `precise` (re-encode, frame-accurate) modes.
- `extractAudio(input, output, options)` — extract the audio track to MP3 or AAC, with bitrate and sample-rate options.
- `thumbnail(input, output, options)` — capture a single frame to JPEG or PNG, with optional resize width.
- `checkDependencies()` — eagerly verify that `ffmpeg` and `ffprobe` are available.
- `onProgress` callbacks on `convert` and `trim`, and `AbortSignal` cancellation on every operation.
- Typed error hierarchy: `FfmScriptError`, `FFmpegNotFoundError`, `FileNotFoundError`, `InvalidFormatError`, `InvalidOptionsError`, `FFmpegError`, `FFmpegTimeoutError`.
- Input validation (file existence, extension, timestamps) before any FFmpeg call.
- Dual ESM + CJS builds with TypeScript declarations.

[Unreleased]: https://github.com/Doud75/ffm-script/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Doud75/ffm-script/releases/tag/v0.1.1
[0.1.0]: https://github.com/Doud75/ffm-script/releases/tag/v0.1.0
