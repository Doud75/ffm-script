# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.0] - 2026-07-04

### Added

- **Distributed executor for `parallelConvert`.** New `executor` option: a `SegmentExecutor` that encodes one keyframe-bounded segment and returns its chunk path. `parallelConvert` still plans the split, encodes the audio in one continuous pass and joins the chunks — it just delegates each video chunk to the executor instead of spawning FFmpeg locally, so you can dispatch the per-segment encodes across independent machines. That is where the chunked model actually scales: on a single machine it doesn't speed anything up (libx264 already saturates the CPU with its internal threading). The default is the built-in local executor, so existing calls are unchanged. The companion `concurrency` option sets how many segments run at once (and how finely the timeline is split), **uncapped** by the host's core count for remote fan-out. New public types `SegmentExecutor` / `SegmentExecutorContext`.
- **Failure recovery for `parallelConvert`.** New `retries` option re-attempts a segment whose encode fails (calling the `executor` again, so a retrying executor can route it to a healthy worker) — for distributed runs where a remote worker can die mid-encode. `retryDelay` spaces the attempts (ms). An **aborted** run is never retried. Defaults to `0` (a single attempt: the first failure rejects the call, as before).

## [0.11.0] - 2026-06-29

### Added

- **Linting & formatting toolchain.** ESLint (flat config) with **type-aware** `typescript-eslint` rules (`recommendedTypeChecked` + `stylisticTypeChecked`) over `src/`, plus Prettier for formatting — neither existed before. New scripts: `pnpm lint`, `pnpm lint:fix`, `pnpm format`, `pnpm format:check`. Configs: `eslint.config.js`, `.prettierrc`, `.prettierignore`.
- **Test coverage reporting.** `pnpm test:coverage` runs Jest with coverage; `coverageThreshold` enforces a minimum (statements 88 / branches 80 / functions 93 / lines 90) so CI fails on regressions. An `lcov` report is emitted for Codecov, with a coverage badge in the README.

### Changed

- **CI** gained a `lint` job (`pnpm lint` + `pnpm format:check`); the `test` job now runs with coverage and uploads the report to Codecov (via OIDC, no token). The whole codebase was reformatted once with Prettier — no behavioural changes.

## [0.10.1] - 2026-06-23

### Changed

- The bundled agent skill is now installable with the cross-agent [`skills` CLI](https://github.com/vercel-labs/skills): run `npx skills add Doud75/ffm-script` to drop it into the right folder for Claude Code, Codex, Cursor and 70+ other agents. The skill moved from `skill/SKILL.md` to `skills/ffm-script/SKILL.md` (the shared Agent Skills layout the CLI expects) and ships under `skills/` in the npm package. Skill content is unchanged; manual install paths in the README were updated accordingly.

## [0.10.0] - 2026-06-21

### Added

- Bundled **Claude Code skill** (`skill/SKILL.md`, shipped in the npm package): teaches the assistant the library's exact public API — signatures, option names, format/output constraints, the typed error hierarchy and recipes — so it stops guessing or hallucinating options. Versioned with the package, so it always matches the installed API. Copy it into a consuming project's `.claude/skills/` to use it (see the README).

## [0.9.0] - 2026-06-21

### Added

- `runStream(args, options)`: streaming counterpart to `run` — pipe a Node `Readable` into FFmpeg's stdin and/or its stdout into a `Writable` (referenced as `pipe:0`/`pipe:1` in the args). Data flows straight through the process **without being buffered in memory**, so very large files are handled with a bounded footprint. Keeps the full engine (progress, `AbortSignal`, timeout, typed errors) and resolves once the process exits and the sink has flushed. Because a pipe isn't seekable, the args must use a streamable format (MPEG-TS, Matroska, or fragmented MP4 via `-movflags frag_keyframe+empty_moov`).

## [0.8.0] - 2026-06-20

### Added

- `setMetadata(input, output, options)`: write or strip container-level metadata tags (`title`, `artist`, `album`, `comment`, `copyright`, `creation_time`, …). Pass `tags` to set them on top of the existing metadata, or `clear: true` to drop the input's tags first — with no `tags`, this strips everything (handy to anonymise a file). Streams are stream-copied (`-c copy`), so editing tags is lossless and near-instant — it never re-encodes the media.

### Changed

- `probe` now reports metadata tags: a `tags` record at the top level (container metadata such as `title`/`artist`/`creation_time`) and a `tags` record on every stream (per-track metadata such as `language`). Both default to an empty object when absent. Purely additive — existing fields are unchanged.

## [0.7.0] - 2026-06-20

### Changed

- `convert` now writes **MOV, MKV and WebM** in addition to MP4 — the output container is chosen from the output extension. Codecs default to the container's natural pair (`libx264`/`aac` for MP4/MOV/MKV, `libvpx-vp9`/`libopus` for WebM) when not given. An explicit codec the container can't carry (e.g. h264 into WebM) is rejected with `InvalidFormatError`, and the x264/x265-only `quality` presets throw `InvalidOptionsError` when paired with a non-CRF codec. Video output is no longer MP4-only.
- `parallelConvert` now writes **MOV and MKV** in addition to MP4 (chosen from the output extension). WebM is rejected with a clear `InvalidFormatError`: the parallel pipeline re-encodes chunks to h264 and stream-copies the joins, which WebM cannot carry — use `convert` for WebM.

## [0.6.0] - 2026-06-19

### Added

- `overlay(input, output, options)`: burn a watermark image (PNG/JPEG/WebP) onto a video. Anchor it to a corner or the centre (`position`), inset it from the edges (`margin`), fade it (`opacity`), and scale it to a `width`. The video is re-encoded (`libx264`) while the audio is stream-copied unchanged; silent inputs are handled.
- `extractSubtitles(input, output, options)`: pull a subtitle track out of a video into a standalone `.srt`, `.vtt` or `.ass` file, converting the embedded codec to the format chosen by the output extension (e.g. MP4 `mov_text` → SubRip). Pick the track with `track` (0-based).
- `burnSubtitles(input, output, options)`: hardcode subtitles into the picture. Render an external file (`subtitles`) or an embedded `track` of the input. The video is re-encoded (`libx264`) and the audio is stream-copied unchanged.
- `toAnimation(input, output, options)`: export a range of a video as an animated image — a GIF or animated WebP, picked from the output extension. GIFs use a per-clip generated palette (`palettegen`/`paletteuse`) for far better quality than the default fixed palette. Control the clip with `start`/`end`, and the size with `fps`/`width`/`loop`.

## [0.5.1] - 2026-06-19

### Added

- `width`/`height` options on `parallelConvert`, matching `convert`: resize the output while transcoding in parallel. The same scale filter is applied to every chunk, so they keep a uniform resolution and the concat demuxer still stream-copies the joins. Setting only one dimension preserves the aspect ratio (the `-2` placeholder resolves identically across chunks, which all share the source dimensions).

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

[0.10.0]: https://github.com/Doud75/ffm-script/releases/tag/v0.10.0
[0.9.0]: https://github.com/Doud75/ffm-script/releases/tag/v0.9.0
[0.8.0]: https://github.com/Doud75/ffm-script/releases/tag/v0.8.0
[0.7.0]: https://github.com/Doud75/ffm-script/releases/tag/v0.7.0
[0.6.0]: https://github.com/Doud75/ffm-script/releases/tag/v0.6.0
[0.5.1]: https://github.com/Doud75/ffm-script/releases/tag/v0.5.1
[0.5.0]: https://github.com/Doud75/ffm-script/releases/tag/v0.5.0
[0.4.0]: https://github.com/Doud75/ffm-script/releases/tag/v0.4.0
[0.3.0]: https://github.com/Doud75/ffm-script/releases/tag/v0.3.0
[0.2.0]: https://github.com/Doud75/ffm-script/releases/tag/v0.2.0
[0.1.1]: https://github.com/Doud75/ffm-script/releases/tag/v0.1.1
[0.1.0]: https://github.com/Doud75/ffm-script/releases/tag/v0.1.0
