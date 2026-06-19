# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-06-19

### Added

- `run(args, options)`: raw FFmpeg escape hatch — pass an arbitrary argument list straight to `ffmpeg` while keeping the library's progress parsing, `AbortSignal`, timeout and typed error hierarchy (`FFmpegError`, `FFmpegNotFoundError`). Arguments are forwarded verbatim (you own the inputs, output and any `-y`). For a progress percentage, pass the media `duration`; the input is **not** auto-probed, since it can't be reliably identified in a free-form argument list.
- `concat(inputs, output, options)`: join several video files into one MP4. `mode: 'fast'` uses the concat demuxer (stream copy, no re-encode, requires matching codecs/parameters), `'precise'` uses the concat filter (re-encodes, handles heterogeneous inputs), and `'auto'` (default) probes the inputs and picks the right one. Reuses the `fast`/`precise` vocabulary established by `trim`.
- `quality` option on `convert`, `parallelConvert` and the chainable `.convert(...)`: a semantic preset (`'high'` / `'balanced'` / `'small'`) mapped to libx264 CRF + speed preset. Mutually exclusive with an explicit video bitrate (constant-quality vs target-size are opposite modes) — setting both throws `InvalidOptionsError`.
- Chainable `.raw(args)`: the in-pipeline escape hatch — inject arbitrary FFmpeg flags into the fused `trim`/`convert` command (the counterpart to `run` inside a chain). Flags are appended to the output side so explicit ones override the generated defaults (e.g. a `-vf` overrides the scale from `.convert({ width })`), and it forces a re-encode.

## [0.4.0] - 2026-06-18

### Added

- `parallelConvert` now accepts **MOV, WebM and MKV** inputs in addition to MP4 (output stays MP4). Keyframes are read from the ISOBMFF `stss` box for MP4/MOV, and re-indexed via ffprobe packet flags for Matroska/WebM (or any ISOBMFF the binary parser can't handle). Exposes the new building block `resolveKeyframes`.
- `parallelConvert` now handles **all-intra** MP4 inputs (no `stss` box). Per the ISOBMFF spec an absent `stss` means every frame is a sync sample, so every frame is treated as a keyframe and segmentation cuts on any frame boundary — instead of failing with `InvalidFormatError`.

### Changed

- `parallelConvert`: long videos are now split into **more, shorter chunks than there are workers** and processed through a bounded worker pool, so a slow chunk no longer leaves other workers idle — better load balancing on uneven content. Chunk count is bounded to keep chunks a sensible minimum length. The `planSegments` building block's option was renamed `workerCount` → `segmentCount` to match.
- `parallelConvert`: audio is now encoded in a **single continuous pass** and muxed back onto the concatenated video, instead of being re-encoded inside each chunk. This removes the per-junction AAC priming that accumulated audio drift and an A/V start offset — joins are now seamless regardless of the number of chunks/workers. Inputs without an audio track are handled too.
- `parallelConvert`: `workers` now defaults to **half** the host's logical CPU cores (at least 1) instead of all of them, keeping the machine usable during the transcode and avoiding CPU oversubscription (each FFmpeg worker is already multithreaded). A `workers` value above the core count is now capped to it.

## [0.3.0] - 2026-06-18

### Added

- `parallelConvert(input, output, options)`: keyframe-aware parallel transcoding — splits the MP4 on keyframe boundaries (parsed directly from the `stss` box), re-encodes the chunks across N workers, then concatenates them without re-encoding (artefact-free joins). Also exposes the building blocks `extractKeyframeIndex` and `planSegments`.

## [0.2.0] - 2026-06-16

### Added

- Additional input formats: video operations now accept MOV, WebM and MKV in addition to MP4; `probe` and `extractAudio` also accept audio-only inputs (MP3, AAC, WAV, FLAC, M4A). Video output remains MP4.
- `toHLS(input, outputDir, options)`: package a video into adaptive-bitrate HLS — a `master.m3u8` plus one variant folder (playlist + `.ts` segments) per requested resolution, with configurable segment duration and progress/abort support.
- Chainable API `ffmscript(input).trim(...).convert(...).save(output)`: fuses `trim` and `convert` into a single FFmpeg pass instead of running separate processes.

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

[0.6.0]: https://github.com/Doud75/ffm-script/releases/tag/v0.5.0
[0.4.0]: https://github.com/Doud75/ffm-script/releases/tag/v0.4.0
[0.3.0]: https://github.com/Doud75/ffm-script/releases/tag/v0.3.0
[0.2.0]: https://github.com/Doud75/ffm-script/releases/tag/v0.2.0
[0.1.1]: https://github.com/Doud75/ffm-script/releases/tag/v0.1.1
[0.1.0]: https://github.com/Doud75/ffm-script/releases/tag/v0.1.0
