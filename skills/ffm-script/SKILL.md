---
name: ffm-script
description: Use when writing, reviewing, or debugging Node.js/TypeScript code that uses the "ffm-script" npm package (a dependency-free FFmpeg CLI wrapper). Provides exact public API signatures, format/output constraints, the typed error hierarchy, and copy-paste recipes for probe, convert, parallelConvert, trim, extractAudio, thumbnail, toHLS, overlay, subtitles, toAnimation, concat, setMetadata, run/runStream, and the chainable API. Use it instead of guessing signatures or option names.
---

# ffm-script

`ffm-script` is a modern, **zero-runtime-dependency** TypeScript wrapper around the **FFmpeg binary** (a spiritual successor to the archived `fluent-ffmpeg`). It shells out to `ffmpeg`/`ffprobe`; it does not bundle them.

This skill describes the public API **exactly** so you don't have to guess signatures, option names, defaults, or constraints.

## Prerequisite (critical)

FFmpeg (providing both `ffmpeg` and `ffprobe`) **must be installed** on the machine and on `PATH`, or pointed at via the `FFMPEG_PATH` / `FFPROBE_PATH` environment variables. Requires **Node.js >= 22**. Dual ESM + CJS, fully typed.

```ts
import { checkDependencies, FFmpegNotFoundError } from 'ffm-script';
// Fail fast at startup: throws FFmpegNotFoundError (with install instructions) if missing.
checkDependencies();
```

## Conventions shared by every operation

- Most operations are `(input, output, options?) => Promise<void>` and **overwrite** the output.
- `onProgress?: (p: { percent: number; currentTime: number; totalTime: number; fps?: number; speed?: number; bitrate?: number; eta?: number }) => void` — `percent` is clamped to [0, 100]. `fps`, `speed` (× realtime), `bitrate` (bits/s) and `eta` (seconds remaining) are added when FFmpeg reports them (the first frames omit them).
- `signal?: AbortSignal` — aborting kills FFmpeg and rejects with a `DOMException` named `'AbortError'` (SIGTERM, lets FFmpeg clean up).
- Inputs are validated **before** FFmpeg is spawned (existence, extension, ranges) → fast typed errors, never raw stderr.

## Supported formats

- **Video input** (`VIDEO_INPUT_FORMATS`): `.mp4`, `.mov`, `.webm`, `.mkv`
- **Audio-only input** (`AUDIO_INPUT_FORMATS`): `.mp3`, `.aac`, `.wav`, `.flac`, `.m4a`
- `probe`, `extractAudio`, `setMetadata` accept **any** of the above. Other video operations accept video containers.
- **Output container is chosen from the output file extension.** No separate "format" option.

## Public API — exact signatures

### Metadata

```ts
probe(file: string): Promise<ProbeResult>
```

`ProbeResult`: `{ duration: number; size: number; bitrate: number; streams: Stream[]; video: VideoStream | null; audio: AudioStream | null; tags: Record<string,string> }`.

- `Stream`: `{ index, type: 'video'|'audio'|'subtitle'|'data', codec, tags: Record<string,string> }`.
- `VideoStream`: adds `width, height, fps, bitrate, rotation` (rotation normalized to [0,360)).
- `AudioStream`: adds `sampleRate, channels, bitrate`.
- `tags` (top level = container, per-stream = track, e.g. `language`) default to `{}`. Numbers are `0` when unknown.

```ts
setMetadata(input: string, output: string, options?: {
  tags?: Record<string,string>   // e.g. { title: 'My Movie', artist: 'Me' }
  clear?: boolean                 // drop all input tags first (-map_metadata -1)
  signal?: AbortSignal
}): Promise<void>
```

Stream-copies everything (`-c copy`) → lossless, near-instant. Works on audio-only files too. Use the **same container** for output as input. Throws `InvalidOptionsError` if neither `tags` nor `clear` is given, or a key is empty / contains `=`.

### Transcode

```ts
convert(input: string, output: string, options?: {
  videoCodec?: string    // -c:v; default depends on container (libx264 for mp4/mov/mkv, libvpx-vp9 for webm)
  audioCodec?: string    // -c:a; default aac (mp4/mov/mkv) or libopus (webm)
  quality?: 'high' | 'balanced' | 'small'   // CRF preset; mutually exclusive with videoBitrate
  videoBitrate?: string  // -b:v e.g. '2500k'
  audioBitrate?: string  // -b:a e.g. '192k'
  width?: number         // set one dimension to preserve aspect ratio
  height?: number
  onProgress?, signal?
}): Promise<void>
```

- Output container from extension: `.mp4`/`.mov`/`.mkv`/`.webm`.
- `quality` maps to libx264 CRF + speed: `high`=`-crf 18 -preset slow`, `balanced`=`-crf 23 -preset medium`, `small`=`-crf 28 -preset medium`. **Constant-quality**, so mutually exclusive with `videoBitrate` (throws `InvalidOptionsError` if both). `quality` requires an x264/x265-family codec.
- An explicit codec a container can't carry (e.g. `libx264` into `.webm`) throws `InvalidFormatError`.

```ts
parallelConvert(input: string, output: string, options?: {
  workers?: number       // default: half the host's logical cores (>=1), capped to core count
  executor?: SegmentExecutor  // custom per-segment encoder → distribute chunks across machines; default = local FFmpeg
  concurrency?: number   // segments in flight; only with a custom executor, NOT capped to core count
  retries?: number       // re-attempt a failed segment N times (default 0); never retries an abort
  retryDelay?: number    // ms to wait between retry attempts (default 0)
  targetBitrate?: string // -b:v; mutually exclusive with quality
  quality?: 'high' | 'balanced' | 'small'
  width?: number
  height?: number
  onProgress?, signal?
}): Promise<void>

// SegmentExecutor: encode one segment, return the chunk path (h264, same params for every chunk).
type SegmentExecutor = (
  segment: { index: number; startTime: number; endTime?: number },
  ctx: {
    input: string;        // source to encode from
    encodeArgs: string[]; // shared video-encode flags every chunk must use verbatim
    duration: number;     // segment length in seconds (use for -t; last segment runs to EOF)
    onProgress?: (secondsProcessed: number) => void;
    signal?: AbortSignal;
  },
) => Promise<string>;     // path to the produced chunk, readable where the join runs
```

Keyframe-aware parallel transcoding: splits on keyframes, re-encodes chunks across workers, joins without re-encoding. Output: `.mp4`/`.mov`/`.mkv` only — **`.webm` is rejected** (`InvalidFormatError`); use `convert` for WebM. Inputs: MP4/MOV/WebM/MKV.

**convert vs parallelConvert:** `parallelConvert` gives **no speedup on a single machine** — FFmpeg (libx264) already saturates every core with its internal threading, so local workers only re-share the same cores. It is the building block of the distributed chunked pipeline (YouTube/Netflix model): pass an `executor` to run each segment's encode on independent machines (`parallelConvert` still plans the split, encodes the audio in one pass, and joins the chunks) and throughput scales near-linearly. Locally it guarantees the pipeline's correctness (duration kept, artefact-free joins, drift-free audio). For a plain local transcode, short clips, WebM output, or a precise single-pass encode, use `convert`.

### Edit

```ts
trim(input: string, output: string, options: {   // options REQUIRED
  start: number | string   // seconds or 'HH:MM:SS[.ms]'
  end: number | string     // must be > start
  mode?: 'fast' | 'precise'  // default 'fast'
  onProgress?, signal?
}): Promise<void>
```

Output must be `.mp4`. `fast` = stream copy, cuts on nearest keyframe (may be off by a few seconds, no re-encode). `precise` = re-encode, frame-accurate, slower.

```ts
extractAudio(input: string, output: string, options?: {
  codec?: 'mp3' | 'aac'    // inferred from output extension when omitted
  bitrate?: string         // -b:a e.g. '320k'
  sampleRate?: number      // -ar e.g. 44100
  signal?
}): Promise<void>
```

Output `.mp3` / `.aac` / `.m4a`. Accepts video or audio-only input.

```ts
thumbnail(input: string, output: string, options: {   // options REQUIRED
  timestamp: number | string  // seconds or 'HH:MM:SS[.ms]'
  width?: number              // height auto-scaled
  signal?
}): Promise<void>
```

Output `.jpg` / `.png`.

```ts
concat(inputs: string[], output: string, options?: {  // inputs.length >= 2
  mode?: 'fast' | 'precise' | 'auto'   // default 'auto'
  onProgress?, signal?
}): Promise<void>
```

Output must be `.mp4`. `fast` = concat demuxer (`-c copy`, needs identical codecs/params). `precise` = concat filter (re-encodes, handles heterogeneous inputs). `auto` probes and picks. `precise` needs all inputs to agree on having an audio track or none (else `InvalidOptionsError`).

### Rich media

```ts
overlay(input: string, output: string, options: {    // options REQUIRED
  watermark: string   // path to PNG/JPEG/WebP
  position?: 'top-left'|'top-right'|'bottom-left'|'bottom-right'|'center'  // default 'bottom-right'
  margin?: number     // px from edges, ignored for 'center'; default 10
  opacity?: number    // 0..1; default 1
  width?: number      // scale watermark; height preserves ratio
  onProgress?, signal?
}): Promise<void>
```

Output must be `.mp4`. Video re-encoded (libx264), audio stream-copied (silent inputs handled).

```ts
extractSubtitles(input: string, output: string, options?: { track?: number; signal? }): Promise<void>
burnSubtitles(input: string, output: string, options?: {
  subtitles?: string  // external .srt/.vtt/.ass; if omitted, burns embedded `track`
  track?: number      // 0-based; default 0
  onProgress?, signal?
}): Promise<void>
```

`extractSubtitles` output `.srt`/`.vtt`/`.ass` (codec converted by extension). `burnSubtitles` output must be `.mp4` (video re-encoded, audio copied).

```ts
toAnimation(input: string, output: string, options?: {
  start?: number | string  // default 0
  end?: number | string    // default end of input
  fps?: number             // default 15
  width?: number
  loop?: number            // 0 = forever (default), -1 = play once
  onProgress?, signal?
}): Promise<void>
```

Output `.gif` (per-clip generated palette) or `.webp` (animated WebP).

### Packaging

```ts
toHLS(input: string, outputDir: string, options: {   // options REQUIRED
  resolutions: { width: number; bitrate: string; name?: string }[]  // the ABR ladder
  segmentDuration?: number   // seconds; default 6
  onProgress?, signal?
}): Promise<void>
```

Writes `outputDir/master.m3u8` + one variant folder (playlist + `.ts`) per resolution.

### Escape hatches

```ts
run(args: string[], options?: {
  duration?: number   // enables progress %; input is NOT auto-probed
  onProgress?, signal?, timeout?: number  // timeout ms -> SIGKILL -> FFmpegTimeoutError
}): Promise<string>   // resolves with captured stdout
```

Raw arbitrary FFmpeg args, verbatim — you own inputs, output, and any `-y`. Keeps progress/abort/timeout/typed errors. Throws `InvalidOptionsError` if `args` is empty.

```ts
runStream(args: string[], options?: {
  input?: Readable    // piped to stdin; reference as 'pipe:0' in args
  output?: Writable   // FFmpeg stdout piped here; reference as 'pipe:1' in args
  duration?, onProgress?, signal?, timeout?
}): Promise<void>
```

Streaming counterpart to `run`: data flows through the process **without buffering in memory** (bounded footprint for huge files). **Pipes can't seek** → use a streamable format: MPEG-TS, Matroska, or fragmented MP4 (`-movflags frag_keyframe+empty_moov`) for piped output; a linearly-decodable input for piped input. A plain `moov`-at-end MP4 cannot be piped.

### Chainable API

`ffmscript(input)` returns a `FfmScriptChain`:

```ts
ffmscript(input: string)
  .trim(options: TrimOptions)
  .convert(options: ConvertOptions)
  .raw(args: string[])          // inject raw flags on the output side; forces re-encode
  .save(output: string, options?: { onProgress?, signal? }): Promise<void>
```

Fuses `trim` + `convert` into a **single** FFmpeg pass. Order-independent. Output must be `.mp4`. `.save()` throws `InvalidOptionsError` if no operation was queued. `.raw()` flags are appended after generated ones, so explicit flags win (a `-vf` overrides the scale from `.convert({ width })`).

### Building blocks (advanced)

`extractKeyframeIndex(file)`, `resolveKeyframes(file)`, `planSegments(keyframes, { segmentCount })` — the internals behind `parallelConvert`, plus the `Keyframe` / `Segment` types. To distribute the chunked pipeline, prefer the `executor` option on `parallelConvert` (it reuses the built-in audio pass + join); these primitives are the lower-level path if you want to plan the split and join (`concat({ mode: 'fast' })`) entirely yourself.

## Error hierarchy

All extend `FfmScriptError`. Catch the base, or narrow:

| Error                 | When                                                                 |
| --------------------- | -------------------------------------------------------------------- |
| `FFmpegNotFoundError` | `ffmpeg`/`ffprobe` not found (message includes install instructions) |
| `FileNotFoundError`   | input file missing                                                   |
| `InvalidFormatError`  | unsupported extension / incompatible codec+container                 |
| `InvalidOptionsError` | bad options (timestamp, range, width, mutually-exclusive opts…)      |
| `FFmpegError`         | FFmpeg exited non-zero — has `.stderr` and `.exitCode`               |
| `FFmpegTimeoutError`  | a `run`/`runStream` exceeded `timeout` — has `.duration` (ms)        |

```ts
import { FFmpegError, FFmpegNotFoundError } from 'ffm-script';
try {
  await convert('in.mp4', 'out.mp4');
} catch (err) {
  if (err instanceof FFmpegNotFoundError) console.error(err.message);
  if (err instanceof FFmpegError) console.error(err.exitCode, err.stderr);
}
```

## Recipes

```ts
import {
  probe,
  convert,
  parallelConvert,
  trim,
  extractAudio,
  thumbnail,
  toHLS,
  overlay,
  burnSubtitles,
  toAnimation,
  concat,
  setMetadata,
  run,
  runStream,
  ffmscript,
} from 'ffm-script';

// Inspect
const info = await probe('in.mp4'); // info.duration, info.video?.width, info.tags.title

// Transcode + resize, with a quality preset
await convert('in.mp4', 'out.mp4', { quality: 'balanced', width: 1280 });

// Chunked transcode — validates the split/join pipeline; no speedup vs convert
// on one machine (see "convert vs parallelConvert")
await parallelConvert('movie.mkv', 'out.mp4', { workers: 4, quality: 'balanced' });

// Transcode to WebM (use convert, NOT parallelConvert)
await convert('in.mp4', 'out.webm'); // VP9 + Opus by default

// Precise cut
await trim('in.mp4', 'cut.mp4', { start: '00:01:00', end: '00:03:00', mode: 'precise' });

// One-pass trim + resize
await ffmscript('in.mp4').trim({ start: 60, end: 180 }).convert({ width: 1280 }).save('out.mp4');

// Audio, thumbnail, GIF
await extractAudio('in.mp4', 'out.mp3', { bitrate: '320k' });
await thumbnail('in.mp4', 'thumb.jpg', { timestamp: 30, width: 640 });
await toAnimation('in.mp4', 'clip.gif', { start: 3, end: 6, fps: 12, width: 480 });

// HLS ladder
await toHLS('in.mp4', './hls/', {
  resolutions: [
    { width: 1920, bitrate: '5000k' },
    { width: 1280, bitrate: '2500k' },
  ],
});

// Watermark, burn subtitles
await overlay('in.mp4', 'out.mp4', {
  watermark: 'logo.png',
  position: 'bottom-right',
  opacity: 0.6,
});
await burnSubtitles('in.mp4', 'out.mp4', { subtitles: 'subs.srt' });

// Join files
await concat(['intro.mp4', 'main.mp4', 'outro.mp4'], 'out.mp4', { mode: 'auto' });

// Tags (lossless)
await setMetadata('in.mp4', 'out.mp4', { tags: { title: 'My Movie', artist: 'Me' } });

// Escape hatch
await run(['-i', 'in.mp4', '-vf', 'scale=1280:-2', '-crf', '18', '-y', 'out.mp4'], {
  duration: 124,
});

// Streaming, bounded memory (note the fragmented-MP4 flags for pipe output)
import { createReadStream, createWriteStream } from 'node:fs';
await runStream(
  [
    '-i',
    'pipe:0',
    '-c:v',
    'libx264',
    '-movflags',
    'frag_keyframe+empty_moov',
    '-f',
    'mp4',
    'pipe:1',
  ],
  { input: createReadStream('big.mov'), output: createWriteStream('out.mp4') },
);
```

## Gotchas to avoid

- Don't set both `quality` and `videoBitrate`/`targetBitrate` → `InvalidOptionsError`.
- Don't reach for `parallelConvert` expecting a faster local encode — on one machine it performs like `convert`; its value is the distributed chunked pipeline.
- Don't send `.webm` to `parallelConvert` → use `convert`.
- `trim`, `overlay`, `burnSubtitles`, `concat`, and the chain `.save()` require a **`.mp4`** output.
- `run`/`runStream` don't auto-probe — pass `duration` if you want a progress percentage.
- For piped I/O, a plain MP4 won't work (no seeking) — use MPEG-TS, MKV, or fragmented MP4.
- Output extension determines the container; there is no format option.
