import { extname } from 'node:path';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { validateInput } from '../core/validate.js';
import { InvalidFormatError, InvalidOptionsError } from '../errors/index.js';
import type { ExtractAudioOptions } from '../types/index.js';

type AudioCodec = NonNullable<ExtractAudioOptions['codec']>;

/** FFmpeg encoder and accepted output extensions for each supported codec. */
const CODECS: Record<AudioCodec, { encoder: string; extensions: string[] }> = {
  mp3: { encoder: 'libmp3lame', extensions: ['.mp3'] },
  aac: { encoder: 'aac', extensions: ['.aac', '.m4a'] },
};

/**
 * Extracts the audio track of an MP4 file to a standalone MP3 or AAC file.
 *
 * The codec is taken from `options.codec` when given, otherwise inferred from
 * the output extension (`.mp3` → mp3, `.aac`/`.m4a` → aac).
 *
 * @param input - Path to the source MP4 file.
 * @param output - Path to the destination audio file.
 * @param options - Codec, bitrate and sample rate options.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when `input` is not `.mp4` or the output
 * extension is incompatible with the chosen codec.
 * @throws {InvalidOptionsError} when no codec is given and it cannot be inferred.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function extractAudio(
  input: string,
  output: string,
  options: ExtractAudioOptions = {},
): Promise<void> {
  await validateInput(input, ['.mp4']);

  const ext = extname(output).toLowerCase();
  const codec = options.codec ?? inferCodec(ext);
  const { encoder, extensions } = CODECS[codec];
  if (!extensions.includes(ext)) {
    throw new InvalidFormatError(
      output,
      `extension "${ext || '(none)'}" is incompatible with codec "${codec}" (expected ${extensions.join(', ')})`,
    );
  }

  const args = ['-i', input, '-vn', '-c:a', encoder];
  if (options.bitrate !== undefined) args.push('-b:a', options.bitrate);
  if (options.sampleRate !== undefined) args.push('-ar', String(options.sampleRate));
  args.push('-y', output);

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}

/** Infers the audio codec from the output extension. */
function inferCodec(ext: string): AudioCodec {
  for (const codec of Object.keys(CODECS) as AudioCodec[]) {
    if (CODECS[codec].extensions.includes(ext)) return codec;
  }
  throw new InvalidOptionsError(
    `cannot infer audio codec from output "${ext || '(no extension)'}"; pass options.codec ('mp3' | 'aac')`,
  );
}
