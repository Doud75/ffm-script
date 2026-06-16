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
