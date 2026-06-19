# ffm-script

A modern, TypeScript-native wrapper around the **FFmpeg binary** for common media operations — a spiritual successor to [`fluent-ffmpeg`](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) (archived in May 2025).

- 🟦 **TypeScript-first** — strict types, full JSDoc, dual ESM + CJS builds.
- 🪶 **Zero runtime dependencies** — it shells out to the FFmpeg binary you already have.
- 🎯 **Focused API** — `probe`, `convert`, `trim`, `extractAudio`, `thumbnail`.
- ⏳ **Progress & cancellation** — `onProgress` callbacks and `AbortSignal` support.
- 🧱 **Typed errors** — catch exactly what went wrong.

## Why this exists

`fluent-ffmpeg` was the de-facto way to drive FFmpeg from Node, but it was archived in May 2025. The remaining options are low-level native C bindings (`node-av`, `@mmomtchev/ffmpeg`) — powerful but complex and segfault-prone — or `ffmpeg.wasm`, which doesn't run server-side in Node. `ffm-script` fills that gap with a small, high-level API that wraps the FFmpeg **binary** for the operations applications actually need.

## Prerequisites

FFmpeg (which provides both `ffmpeg` and `ffprobe`) must be installed and available:

| Platform | Install |
| --- | --- |
| macOS | `brew install ffmpeg` |
| Ubuntu | `sudo apt-get install ffmpeg` |
| Windows | `winget install Gyan.FFmpeg` |
| Other | <https://ffmpeg.org/download.html> |

If the binaries aren't on your `PATH`, point the library at them with the `FFMPEG_PATH` and `FFPROBE_PATH` environment variables.

Requires **Node.js >= 22**.

## Install

```sh
pnpm add ffm-script
# or: npm install ffm-script / yarn add ffm-script
```

> **Formats:** input MP4 / MOV / WebM / MKV (plus MP3 / AAC / WAV / FLAC / M4A for audio); video output is MP4. Audio extraction targets MP3/AAC; thumbnails target JPEG/PNG.

## Usage

### Check FFmpeg is available

Fail fast at startup with a clear, actionable message:

```ts
import { checkDependencies } from 'ffm-script'

checkDependencies() // throws FFmpegNotFoundError if ffmpeg/ffprobe are missing
```

### Read metadata — `probe`

```ts
import { probe } from 'ffm-script'

const info = await probe('video.mp4')
console.log(info.duration)     // 124.5 (seconds)
console.log(info.video?.codec) // "h264"
console.log(info.video?.width) // 1920
console.log(info.audio?.codec) // "aac"
```

### Transcode — `convert`

```ts
import { convert } from 'ffm-script'

await convert('input.mp4', 'output.mp4', {
  videoCodec: 'libx264', // default
  audioBitrate: '192k',
  width: 1280,           // height auto-scaled to preserve aspect ratio
  onProgress: (p) => console.log(`${p.percent.toFixed(0)}%`),
})
```

#### Quality presets

`convert`, `parallelConvert` and the chainable `.convert(...)` accept a semantic `quality` preset instead of fiddling with bitrates. Each maps to a libx264 CRF (the quality/size dial) and speed preset:

```ts
await convert('input.mp4', 'output.mp4', { quality: 'high' })
```

| Preset | FFmpeg | Use it for |
| --- | --- | --- |
| `high` | `-crf 18 -preset slow` | Visually lossless, larger files |
| `balanced` | `-crf 23 -preset medium` | Sensible default trade-off |
| `small` | `-crf 28 -preset medium` | Smaller files, lower quality |

`quality` is **constant-quality** encoding, so it's mutually exclusive with an explicit video bitrate (`videoBitrate` / `targetBitrate`, which target a *size*) — setting both throws `InvalidOptionsError`. Pick one.

### Cut — `trim`

```ts
import { trim } from 'ffm-script'

await trim('input.mp4', 'output.mp4', {
  start: '00:01:00',
  end: '00:03:00',
  mode: 'fast', // 'fast' = no re-encode, cuts on the nearest keyframe (default)
                // 'precise' = re-encode for a frame-accurate cut (slower)
})
```

### Extract audio — `extractAudio`

```ts
import { extractAudio } from 'ffm-script'

await extractAudio('input.mp4', 'output.mp3', {
  codec: 'mp3', // or inferred from the .mp3 / .aac / .m4a extension
  bitrate: '320k',
})
```

### Capture a thumbnail — `thumbnail`

```ts
import { thumbnail } from 'ffm-script'

await thumbnail('input.mp4', 'thumb.jpg', {
  timestamp: 30, // seconds, or '00:00:30'
  width: 640,
})
```

### Package as HLS — `toHLS`

```ts
import { toHLS } from 'ffm-script'

await toHLS('input.mp4', './output/', {
  segmentDuration: 6,
  resolutions: [
    { width: 1920, bitrate: '5000k' },
    { width: 1280, bitrate: '2500k' },
    { width: 854,  bitrate: '1000k' },
  ],
  onProgress: (p) => console.log(`${p.percent.toFixed(0)}%`),
})
// → output/master.m3u8 + output/1920/ + output/1280/ + output/854/
```

### Chainable API — `ffmscript`

Fuse `trim` and `convert` into a **single** FFmpeg pass (not separate processes):

```ts
import { ffmscript } from 'ffm-script'

await ffmscript('input.mp4')
  .trim({ start: 60, end: 180 })
  .convert({ width: 1280 })
  .save('output.mp4', { onProgress: (p) => console.log(`${p.percent.toFixed(0)}%`) })
```

Need a flag the typed options don't expose? `.raw(args)` injects arbitrary FFmpeg arguments into the same fused pass — the in-pipeline counterpart to [`run`](#raw-ffmpeg--run):

```ts
await ffmscript('input.mp4')
  .trim({ start: 60, end: 180 })
  .raw(['-vf', 'eq=contrast=1.2', '-crf', '18'])
  .save('output.mp4')
```

Raw flags are appended to the **output** side, after the options generated from `trim`/`convert`, so an explicit flag wins over a generated one (a `-vf` here overrides the scale from `.convert({ width })`). `.raw()` forces a re-encode — for pure stream-copy or muxer-only tweaks, use [`run`](#raw-ffmpeg--run) instead.

### Parallel transcode — `parallelConvert`

Splits the video on keyframe boundaries, re-encodes the chunks across N workers, then joins them without re-encoding (artefact-free). The audio is encoded in a single continuous pass and muxed back, so the joins stay drift-free no matter how many chunks the video is cut into. Accepts MP4, MOV, WebM and MKV inputs (output is always MP4) — keyframes come from the ISOBMFF `stss` box when available, otherwise from ffprobe:

```ts
import { parallelConvert } from 'ffm-script'

await parallelConvert('input.mp4', 'output.mp4', {
  workers: 4,
  targetBitrate: '2000k',
  width: 1280,           // height auto-scaled to preserve aspect ratio
  onProgress: (p) => console.log(`${p.percent.toFixed(0)}%`),
})
```

`workers` is optional. It defaults to **half the host's logical cores** (at least 1) so the machine stays usable during the transcode — each FFmpeg worker is itself multithreaded, so one worker per core would oversubscribe the CPU. A value above the core count is capped to it.

`width` / `height` resize the output just like [`convert`](#transcode--convert) — set one to preserve the aspect ratio, or both to force exact dimensions. The same scale is applied to every chunk, so the joins stay artefact-free.

### Concatenate files — `concat`

Join several videos into one MP4. FFmpeg has two concat mechanisms and the classic trap is picking the wrong one, so `concat` exposes both behind a familiar `fast` / `precise` choice — plus `auto`, which probes the inputs and decides for you:

```ts
import { concat } from 'ffm-script'

await concat(['intro.mp4', 'main.mp4', 'outro.mp4'], 'out.mp4', {
  mode: 'auto', // 'fast' | 'precise' | 'auto' (default)
  onProgress: (p) => console.log(`${p.percent.toFixed(0)}%`),
})
```

| Mode | Mechanism | Re-encode? | Constraint |
| --- | --- | --- | --- |
| `fast` | concat demuxer (`-c copy`) | No, fast | Inputs must share the same codecs/resolution/parameters, or the output is corrupt |
| `precise` | concat filter (`-filter_complex concat`) | Yes, slower | Handles heterogeneous inputs |
| `auto` | probes the inputs | When needed | Picks `fast` for compatible inputs, `precise` otherwise |

`precise` needs every input to agree on whether it carries an audio track (all or none); mixing the two throws `InvalidOptionsError`.

### Watermark — `overlay`

Burn an image (PNG/JPEG/WebP) onto a video. Anchor it to a corner or the centre, inset it from the edges, fade it, and scale it. The video is re-encoded; the audio is copied through untouched:

```ts
import { overlay } from 'ffm-script'

await overlay('input.mp4', 'output.mp4', {
  watermark: 'logo.png',
  position: 'bottom-right', // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
  margin: 20,               // px from the edges (ignored for 'center'); default 10
  opacity: 0.6,             // 0–1; default 1 (opaque)
  width: 160,               // scale the watermark; height preserves aspect ratio
  onProgress: (p) => console.log(`${p.percent.toFixed(0)}%`),
})
```

Only `watermark` is required — it defaults to a fully opaque logo in the bottom-right corner at its native size.

### Subtitles — `extractSubtitles` / `burnSubtitles`

Pull a subtitle track out into a standalone file (`.srt`, `.vtt` or `.ass`) — the embedded codec is converted to the format you ask for via the output extension:

```ts
import { extractSubtitles } from 'ffm-script'

await extractSubtitles('movie.mkv', 'subs.srt', { track: 0 }) // track defaults to 0
```

Or hardcode subtitles into the picture (burn-in) — from an external file, or from a track already embedded in the input. The video is re-encoded; the audio is copied through:

```ts
import { burnSubtitles } from 'ffm-script'

// From an external file
await burnSubtitles('input.mp4', 'output.mp4', { subtitles: 'subs.srt' })

// From an embedded track
await burnSubtitles('movie.mkv', 'output.mp4', { track: 0 })
```

### Animated GIF / WebP — `toAnimation`

Export a slice of a video as an animated image. The format is taken from the output extension — `.gif` (with a per-clip generated palette for crisp colours) or `.webp` (truecolour animated WebP):

```ts
import { toAnimation } from 'ffm-script'

await toAnimation('input.mp4', 'clip.gif', {
  start: 3,    // seconds, or 'HH:MM:SS[.ms]'; default 0
  end: 6,      // default end of the input
  fps: 12,     // default 15
  width: 480,  // scaled, aspect ratio preserved
  loop: 0,     // 0 loops forever (default), -1 plays once
})

await toAnimation('input.mp4', 'clip.webp', { end: 4 }) // animated WebP
```

GIFs are capped at 256 colours, so `toAnimation` generates an optimal palette per clip and reuses it — much better than FFmpeg's default fixed palette. Keep `fps`, `width` and the range small to keep the file light.

### Raw FFmpeg — `run`

The escape hatch for anything the typed operations don't cover. Pass an arbitrary argument list straight to `ffmpeg` and still get progress parsing, cancellation, timeout and the typed error hierarchy. Arguments are forwarded verbatim — you own the inputs, the output, and any `-y` to overwrite:

```ts
import { run } from 'ffm-script'

await run(['-i', 'input.mp4', '-vf', 'scale=1280:-2', '-crf', '18', '-y', 'out.mp4'], {
  duration: 124, // optional, enables the progress percentage
  onProgress: (p) => console.log(`${p.percent.toFixed(0)}%`),
  timeout: 60_000,
})
```

For a progress percentage, pass the media `duration` — the input is **not** auto-probed, since there's no reliable way to tell which token is the input in a free-form argument list. Without it the run still works, it just emits no progress.

## Progress

`convert` and `trim` accept an `onProgress` callback. The percentage is parsed from FFmpeg's output against the known duration:

```ts
await convert('input.mp4', 'output.mp4', {
  onProgress: ({ percent, currentTime, totalTime }) => {
    console.log(`${percent.toFixed(1)}% — ${currentTime}/${totalTime}s`)
  },
})
```

## Cancellation

Every operation accepts an `AbortSignal`. Aborting kills the FFmpeg process and rejects with an `AbortError`:

```ts
const controller = new AbortController()
setTimeout(() => controller.abort(), 5000)

await convert('input.mp4', 'output.mp4', { signal: controller.signal })
```

## Error handling

All errors extend `FfmScriptError`, so you can catch the base class or narrow by type:

```ts
import {
  FfmScriptError,
  FFmpegNotFoundError,
  FileNotFoundError,
  InvalidFormatError,
  InvalidOptionsError,
  FFmpegError,
  FFmpegTimeoutError,
} from 'ffm-script'

try {
  await probe('video.mp4')
} catch (err) {
  if (err instanceof FFmpegNotFoundError) console.error(err.message) // install instructions included
  if (err instanceof FFmpegError) {
    console.error(err.exitCode) // FFmpeg's exit code
    console.error(err.stderr)   // raw FFmpeg stderr
  }
}
```

| Error | Thrown when |
| --- | --- |
| `FFmpegNotFoundError` | `ffmpeg`/`ffprobe` cannot be located |
| `FileNotFoundError` | the input file does not exist |
| `InvalidFormatError` | the file extension is not supported |
| `InvalidOptionsError` | options are invalid (bad timestamp, range, width…) |
| `FFmpegError` | FFmpeg exited with a non-zero code (`.stderr`, `.exitCode`) |
| `FFmpegTimeoutError` | a process exceeded its timeout (`.duration`) |

**Inputs are validated before FFmpeg is ever spawned** (file existence, extension, timestamps), so you get fast, typed errors instead of parsing FFmpeg's stderr.

## License

MIT
