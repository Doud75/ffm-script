---
name: ffm-script
description: Use when writing, reviewing, or debugging Node.js/TypeScript code that uses the "ffm-script" npm package (a dependency-free FFmpeg CLI wrapper). Provides exact public API signatures, format/output constraints, hardware-acceleration and quality-preset mappings, the typed error hierarchy, and copy-paste recipes for probe, convert, parallelConvert, trim, extractAudio, normalizeAudio, resampleAudio, trimSilence, thumbnail, toHLS, audioToHLS, toSprites, overlay, subtitles, toAnimation, concat, setMetadata, run/runStream, listHwaccels, and the chainable API. Use it instead of guessing signatures or option names.
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
  quality?: 'high' | 'balanced' | 'small'   // constant-quality preset; mutually exclusive with videoBitrate
  videoBitrate?: string  // -b:v e.g. '2500k'
  audioBitrate?: string  // -b:a e.g. '192k'
  width?: number         // set one dimension to preserve aspect ratio
  height?: number
  hwaccel?: string       // -hwaccel: hardware DECODER, e.g. 'cuda' | 'videotoolbox' | 'qsv' | 'vaapi' | 'none'
  onProgress?, signal?
}): Promise<void>
```

- Output container from extension: `.mp4`/`.mov`/`.mkv`/`.webm`.
- `quality` is **constant-quality**, so mutually exclusive with `videoBitrate` (throws `InvalidOptionsError` if both). It is translated per encoder family — see the table below. An encoder in no known family throws `InvalidOptionsError`: use `videoBitrate` there.
- An explicit codec a container can't carry (e.g. `libx264` into `.webm`) throws `InvalidFormatError`.

#### `quality` per encoder family

| Encoder                                         | `high`                       | `balanced`                   | `small`                      |
| ----------------------------------------------- | ---------------------------- | ---------------------------- | ---------------------------- |
| `libx264` / `libx265` (+ `h264`/`hevc` aliases) | `-crf 18 -preset slow`       | `-crf 23 -preset medium`     | `-crf 28 -preset medium`     |
| `*_nvenc`                                       | `-cq 19 -preset p6`          | `-cq 23 -preset p4`          | `-cq 28 -preset p4`          |
| `*_qsv`                                         | `-global_quality 19`         | `-global_quality 23`         | `-global_quality 28`         |
| `*_videotoolbox`                                | `-q:v 65`                    | `-q:v 55`                    | `-q:v 40`                    |
| `*_vaapi`                                       | `-qp 19`                     | `-qp 23`                     | `-qp 28`                     |
| `*_amf`                                         | `-rc cqp -qp_i 19 -qp_p 19`  | `… 23`                       | `… 28`                       |
| `libvpx-vp9`                                    | `-crf 24 -b:v 0`             | `-crf 31 -b:v 0`             | `-crf 37 -b:v 0`             |
| `libsvtav1`                                     | `-crf 28 -preset 6`          | `-crf 35 -preset 8`          | `-crf 45 -preset 8`          |
| `libaom-av1`                                    | `-crf 25 -b:v 0 -cpu-used 4` | `-crf 32 -b:v 0 -cpu-used 5` | `-crf 40 -b:v 0 -cpu-used 6` |

Hardware encoders are matched by **API suffix**, so `hevc_nvenc` and `av1_nvenc` follow the `*_nvenc` row. `*_videotoolbox`'s `-q:v` scale is inverted (higher = better).

#### Hardware acceleration

```ts
listHwaccels(): Promise<string[]>   // e.g. ['videotoolbox'] — memoized
```

- `hwaccel` accelerates **decoding** only; frames come back to system memory, which is why it still composes with `width`/`height`. To accelerate the **encode**, pass a hardware `videoCodec` (`'h264_nvenc'`, `'h264_videotoolbox'`, `'hevc_qsv'`, …).
- The value is passed to FFmpeg untouched — an unavailable method surfaces as `FFmpegError`, not a typed rejection. `listHwaccels()` reports what the FFmpeg **build** supports, which is not proof the host can run it: always keep a software fallback.
- Blank/empty `hwaccel` → `InvalidOptionsError`. `'none'` is valid (explicit software decoding).
- Full-GPU pipelines (`-hwaccel_output_format cuda` + `scale_cuda`) are **not** supported through these options — use `run` for that.

```ts
parallelConvert(input: string, output: string, options?: {
  workers?: number       // default: half the host's logical cores (>=1), capped to core count
  executor?: SegmentExecutor  // custom per-segment encoder → distribute chunks across machines; default = local FFmpeg
  concurrency?: number   // segments in flight; only with a custom executor, NOT capped to core count
  retries?: number       // re-attempt a failed segment N times (default 0); never retries an abort
  retryDelay?: number    // ms to wait between retry attempts (default 0)
  videoBitrate?: string  // -b:v; mutually exclusive with quality
  quality?: 'high' | 'balanced' | 'small'
  videoCodec?: string    // -c:v for every chunk; default libx264. Must be muxable in the output container.
  hwaccel?: string       // -hwaccel applied to every chunk read; handed to a custom executor as ctx.inputArgs
  width?: number
  height?: number
  onProgress?, signal?
}): Promise<void>

// SegmentExecutor: encode one segment, return the chunk path (same codec + params for every chunk).
type SegmentExecutor = (
  segment: { index: number; startTime: number; endTime?: number },
  ctx: {
    input: string;        // source to encode from
    inputArgs: string[];  // flags that must precede the -i (hardware decoder); [] when none
    encodeArgs: string[]; // shared video-encode flags every chunk must use verbatim
    duration: number;     // segment length in seconds (use for -t; last segment runs to EOF)
    onProgress?: (secondsProcessed: number) => void;
    signal?: AbortSignal;
  },
) => Promise<string>;     // path to the produced chunk, readable where the join runs
```

Keyframe-aware parallel transcoding: splits on keyframes, re-encodes chunks across workers, joins without re-encoding. Output: `.mp4`/`.mov`/`.mkv` only — **`.webm` is rejected** (`InvalidFormatError`); use `convert` for WebM. Inputs: MP4/MOV/WebM/MKV.

`videoCodec` and `hwaccel` open the chunk encodes to hardware; every chunk gets identical flags, so a GPU-encoded set still joins with a stream copy. A `videoCodec` the output container can't carry throws `InvalidFormatError` (checked before any work starts). A worker builds its command as `ffmpeg <inputArgs> -ss <startTime> -i <input> [-t <duration>] <encodeArgs> -y <chunk>`.

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
normalizeAudio(input: string, output: string, options?: {
  targetLoudness?: number  // loudnorm I, LUFS; default -16 (streaming). EBU R128 broadcast = -23. Range [-70, -5]
  truePeak?: number        // loudnorm TP, dBTP; default -1.5. Range [-9, 0]
  loudnessRange?: number   // loudnorm LRA, LU; default 11. Range [1, 50]
  sampleRate?: number      // -ar; default = the input's own rate
  audioCodec?: string      // -c:a; default inferred from the output extension
  audioBitrate?: string    // -b:a e.g. '192k'
  onProgress?, signal?
}): Promise<void>
```

EBU R128 loudness normalisation, run as **two FFmpeg passes**: the first measures, the second corrects with those measurements (a one-pass `loudnorm` rides the level and audibly pumps). Accepts video or audio input; output may be `.mp3` / `.aac` / `.m4a` / `.wav` / `.flac` (video dropped) or `.mp4` / `.mov` / `.mkv` / `.webm` (video **copied**, `-c:v copy`). `onProgress` spans both passes as one 0–100 % timeline.

```ts
resampleAudio(input: string, output: string, options?: {
  sampleRate?: number      // -ar, Hz. Range [8000, 192000]
  channels?: number        // -ac, e.g. 1 = mono. Range [1, 8]
  audioCodec?: string      // -c:a; default inferred from the output extension
  audioBitrate?: string    // -b:a
  onProgress?, signal?
}): Promise<void>
```

At least one of `sampleRate` / `channels` is required (else `InvalidOptionsError`). Same input/output formats as `normalizeAudio`, video copied the same way.

```ts
trimSilence(input: string, output: string, options?: {
  mode?: 'start' | 'end' | 'both' | 'all'  // default 'both'
  threshold?: number       // dB below which audio counts as silence; default -50
  minDuration?: number     // seconds; 'all' only — interior silence is shortened to this; default 1
  keepSilence?: number     // seconds of lead-in kept; default 0
  audioCodec?: string, audioBitrate?: string
  signal?                  // NO onProgress — see below
}): Promise<void>
```

**Audio in, audio out** (`.mp3` / `.aac` / `.m4a` / `.wav` / `.flac` both sides): a video input is rejected with `InvalidFormatError`, because cutting the audio timeline without cutting the picture would desynchronise them. No `onProgress`: the output is shorter than the input by design, so any percentage derived from FFmpeg's timestamps would be wrong.

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
  segmentType?: 'ts' | 'fmp4'  // 'ts' MPEG-TS (default) | 'fmp4' CMAF (.m4s + init.mp4)
  onProgress?, signal?
}): Promise<void>
```

Writes `outputDir/master.m3u8` + one variant folder (playlist + segments) per resolution. Video input only.

```ts
audioToHLS(input: string, outputDir: string, options?: {   // options OPTIONAL
  bitrates?: string[]        // AAC ABR ladder; default ['128k']
  segmentDuration?: number   // seconds; default 6
  segmentType?: 'ts' | 'fmp4'  // 'ts' MPEG-TS (default) | 'fmp4' CMAF (.m4s + init.mp4)
  onProgress?, signal?
}): Promise<void>
```

Audio-only counterpart of `toHLS` (bitrate ladder, no scaling). Audio input only (MP3/AAC/WAV/FLAC/M4A). Writes `outputDir/master.m3u8` + one folder per bitrate (named by the bitrate, e.g. `128k/`) — a master is written even for a single bitrate.

```ts
toSprites(input: string, outputDir: string, options?: {   // options OPTIONAL
  interval?: number   // seconds between thumbnails; default 10
  width?: number      // thumbnail width in px, height keeps the ratio; default 160
  columns?: number    // thumbnails per sheet row; default 5
  rows?: number       // rows per sheet; default 5
  format?: 'jpg' | 'png' | 'webp'   // default 'jpg'
  onProgress?, signal?
}): Promise<void>
```

Scrubbing storyboard for a player's progress-bar preview — the companion to `toHLS`. Video input only. Writes fixed names into `outputDir`: `sprite_000.<format>`, `sprite_001.<format>`, … (a new sheet every `columns * rows` thumbnails) plus `storyboard.vtt`, whose cues point at the sheets by **relative** URL with an `#xywh=x,y,w,h` media fragment — serve the directory as-is. Thumbnail height is computed from the source (rotation-aware) so the fragments are pixel-exact. Rejects a grid whose sheet would exceed 16384px on either edge (`InvalidOptionsError`).

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
  .burnSubtitles(options?: BurnSubtitlesOptions)   // burn subs into the picture, same pass
  .overlay(options: OverlayOptions)                // watermark on top, same pass
  .raw(args: string[])          // inject raw flags on the output side; forces re-encode
  .save(output: string, options?: { onProgress?, signal? }): Promise<void>
```

Fuses `trim` + `convert` + `burnSubtitles` + `overlay` into a **single** FFmpeg pass (one re-encode instead of one per operation). Call order-independent. Output must be `.mp4`. `.save()` throws `InvalidOptionsError` if no operation was queued. The last call of each method wins. `.raw()` flags are appended after generated ones, so explicit flags win (a `-vf` overrides the scale from `.convert({ width })`).

`.burnSubtitles()`/`.overlay()` take the same options as the standalone `burnSubtitles`/`overlay`, except `onProgress`/`signal`, which are ignored (they belong to `.save()`), and they validate identically (`FileNotFoundError` for a missing watermark/`.srt`, `InvalidOptionsError` for an out-of-range `opacity`/`margin`/`width`/`track`).

Filters run in a **fixed order** regardless of call order: **scale → subtitles → overlay** — subtitles are rendered at the output resolution, and the watermark sits on top of them. Two consequences:

- With `.trim()`, subtitle cues are on the **trimmed** timeline (the input seek restarts timestamps).
- `.overlay()` builds a `-filter_complex` with explicit `-map`s (the watermark is a second input), so `.raw()` carrying `-vf`, `-filter:v`, `-filter_complex` or `-map` throws `InvalidOptionsError` instead of silently overriding the graph.

### Batch

```ts
processBatch<T, R>(
  items: T[],
  task: (item: T, index: number) => Promise<R>,
  options?: {
    concurrency?: number   // tasks in flight; default half the host's logical cores (>=1), uncapped
    onProgress?: (done: number, total: number) => void   // NOT the Progress object — a file counter
    signal?: AbortSignal
  }
): Promise<R[]>            // results in input order
```

Runs `task` over many items with a bounded pool (the same engine `parallelConvert` uses per chunk), returning each result at its input index. **Fail-fast:** the first task to reject rejects the whole batch (like `Promise.all`); in-flight tasks aren't cancelled by the lib — wire your own `signal` into `task` for that. `task` is arbitrary, so it composes with any operation. Empty `items` → `[]`. Throws `InvalidOptionsError` for a non-positive-integer `concurrency`.

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
  processBatch,
  trim,
  extractAudio,
  normalizeAudio,
  resampleAudio,
  trimSilence,
  thumbnail,
  toHLS,
  audioToHLS,
  toSprites,
  overlay,
  burnSubtitles,
  toAnimation,
  concat,
  setMetadata,
  run,
  runStream,
  ffmscript,
  listHwaccels,
} from 'ffm-script';

// Inspect
const info = await probe('in.mp4'); // info.duration, info.video?.width, info.tags.title

// Transcode + resize, with a quality preset
await convert('in.mp4', 'out.mp4', { quality: 'balanced', width: 1280 });

// Chunked transcode — validates the split/join pipeline; no speedup vs convert
// on one machine (see "convert vs parallelConvert")
await parallelConvert('movie.mkv', 'out.mp4', { workers: 4, quality: 'balanced' });

// Transcode to WebM (use convert, NOT parallelConvert)
await convert('in.mp4', 'out.webm', { quality: 'balanced' }); // VP9 + Opus by default

// Hardware-accelerated transcode, with a software fallback
const accels = await listHwaccels();
const gpu = accels.includes('videotoolbox')
  ? { hwaccel: 'videotoolbox', videoCodec: 'h264_videotoolbox' }
  : {};
await convert('in.mp4', 'out.mp4', { ...gpu, quality: 'balanced' });

// Batch: transcode many files with a bounded pool (fail-fast, results in input order)
await processBatch(files, (f, i) => convert(f, outputs[i], { quality: 'balanced' }), {
  concurrency: 4,
  onProgress: (done, total) => console.log(`${done}/${total}`),
});

// Precise cut
await trim('in.mp4', 'cut.mp4', { start: '00:01:00', end: '00:03:00', mode: 'precise' });

// One-pass trim + resize
await ffmscript('in.mp4').trim({ start: 60, end: 180 }).convert({ width: 1280 }).save('out.mp4');

// One-pass resize + burnt subtitles + watermark (order applied: scale → subs → overlay)
await ffmscript('in.mp4')
  .convert({ width: 1280, quality: 'balanced' })
  .burnSubtitles({ subtitles: 'subs.srt' })
  .overlay({ watermark: 'logo.png', position: 'top-right', opacity: 0.6 })
  .save('out.mp4');

// Audio, thumbnail, GIF
await extractAudio('in.mp4', 'out.mp3', { bitrate: '320k' });

// Loudness-normalise a podcast episode (2 passes, -16 LUFS)
await normalizeAudio('episode.wav', 'episode.mp3', { audioBitrate: '192k' });

// Normalise a video's soundtrack, leaving the picture untouched (-c:v copy)
await normalizeAudio('in.mp4', 'out.mp4');

// Downmix to 16kHz mono for a speech-to-text pipeline
await resampleAudio('in.mp4', 'speech.wav', { sampleRate: 16000, channels: 1 });

// Strip the dead air at both ends, keeping 0.2s of lead-in
await trimSilence('take.wav', 'tight.wav', { keepSilence: 0.2 });

await thumbnail('in.mp4', 'thumb.jpg', { timestamp: 30, width: 640 });
await toAnimation('in.mp4', 'clip.gif', { start: 3, end: 6, fps: 12, width: 480 });

// HLS ladder (video). segmentType: 'fmp4' for CMAF/.m4s + init.mp4
await toHLS('in.mp4', './hls/', {
  resolutions: [
    { width: 1920, bitrate: '5000k' },
    { width: 1280, bitrate: '2500k' },
  ],
});

// HLS ladder (audio-only): bitrate ladder, master.m3u8 + one folder per bitrate
await audioToHLS('podcast.m4a', './audio-hls/', { bitrates: ['128k', '64k'], segmentType: 'fmp4' });

// Scrubbing storyboard next to the HLS output: sprite sheets + storyboard.vtt
await toSprites('in.mp4', './hls/', { interval: 5, width: 160 });
// player side: point the thumbnail track at ./hls/storyboard.vtt

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

- Don't set both `quality` and `videoBitrate` → `InvalidOptionsError`.
- Don't assume `quality` means `-crf` — it is translated per encoder family, and an encoder in no known family (e.g. `mpeg4`) throws `InvalidOptionsError`. Use `videoBitrate` there.
- Don't treat `hwaccel` as an encode accelerator: alone it only accelerates **decoding**. Pair it with a hardware `videoCodec`.
- Don't assume a method from `listHwaccels()` works — it reflects the FFmpeg build, not the host. Keep a software fallback.
- Don't reach for `parallelConvert` expecting a faster local encode — on one machine it performs like `convert`; its value is the distributed chunked pipeline.
- Don't send `.webm` to `parallelConvert` → use `convert`.
- `trim`, `overlay`, `burnSubtitles`, `concat`, and the chain `.save()` require a **`.mp4`** output.
- Don't run `convert` → `burnSubtitles` → `overlay` as three calls: that's three re-encodes. Chain them (`ffmscript(…).convert().burnSubtitles().overlay().save()`) for a single pass.
- Don't expect the chain to honour your filter call order — it is always scale → subtitles → overlay.
- `normalizeAudio` decodes the input **twice** (measure, then correct) — budget roughly double the wall time of a one-pass encode.
- Don't hand `trimSilence` a video file: it's rejected on purpose. Cutting audio without cutting the picture desynchronises them.
- `trimSilence`'s `end`/`both`/`all` modes use `areverse`, which buffers the **whole** stream in memory — fine for a podcast episode, not for a multi-hour recording.
- `minDuration` only bites in `mode: 'all'`; the edge modes remove their silence whatever its length.
- `toSprites`' default `interval: 10` samples one thumbnail per 10s — on a clip shorter than that you get a single tile. Lower `interval` for short inputs.
- Don't move a `toSprites` sheet away from its `storyboard.vtt`: the cue URLs are relative to the VTT.
- `toSprites` output names are fixed (`sprite_%03d.<format>`, `storyboard.vtt`) — like the HLS playlists, there is no naming option. Point it at a dedicated directory.
- `run`/`runStream` don't auto-probe — pass `duration` if you want a progress percentage.
- For piped I/O, a plain MP4 won't work (no seeking) — use MPEG-TS, MKV, or fragmented MP4.
- Output extension determines the container; there is no format option.
