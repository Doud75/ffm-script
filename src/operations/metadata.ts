import { extname } from 'node:path';
import { resolveBinary } from '../core/binary.js';
import { spawnFFmpeg } from '../core/spawn.js';
import { validateInput } from '../core/validate.js';
import { ALL_INPUT_FORMATS } from '../core/formats.js';
import { buildMetadataArgs } from '../core/metadata.js';
import { InvalidFormatError, InvalidOptionsError } from '../errors/index.js';
import type { SetMetadataOptions } from '../types/index.js';

/**
 * Writes (or strips) container-level metadata tags, copying every stream
 * unchanged.
 *
 * Streams are stream-copied (`-c copy`) so the operation is lossless and
 * near-instant — editing tags never re-encodes the media. Provide `tags` to set
 * them on top of the existing metadata, set `clear: true` to drop the input's
 * tags first (with no `tags`, this strips everything — handy to anonymise a
 * file). Read the current tags back with {@link probe}.
 *
 * @param input - Path to the source media file (any supported video/audio format).
 * @param output - Destination path; its extension picks the container (use the
 * same container as the input so `-c copy` stays valid). Overwritten if present.
 * @param options - Tags to write, the `clear` flag and an abort signal.
 * @throws {FileNotFoundError} when `input` does not exist.
 * @throws {InvalidFormatError} when `input` or `output` has an unsupported extension.
 * @throws {InvalidOptionsError} when neither `tags` nor `clear` is given, or a tag key is invalid.
 * @throws {FFmpegNotFoundError} when `ffmpeg` cannot be located.
 * @throws {FFmpegError} when `ffmpeg` exits with a non-zero code.
 */
export async function setMetadata(
  input: string,
  output: string,
  options: SetMetadataOptions = {},
): Promise<void> {
  await validateInput(input, ALL_INPUT_FORMATS);

  const outExt = extname(output).toLowerCase();
  if (!ALL_INPUT_FORMATS.includes(outExt)) {
    const list = ALL_INPUT_FORMATS.join(', ');
    const reason =
      outExt === ''
        ? `missing file extension (supported: ${list})`
        : `unsupported extension "${outExt}" (supported: ${list})`;
    throw new InvalidFormatError(output, reason);
  }

  const tags = options.tags ?? {};
  const clear = options.clear ?? false;
  const keys = Object.keys(tags);

  if (keys.length === 0 && !clear) {
    throw new InvalidOptionsError(
      'nothing to do: provide `tags` to set, or `clear: true` to strip all metadata',
    );
  }
  for (const key of keys) {
    if (key.length === 0 || key.includes('=')) {
      throw new InvalidOptionsError(
        `invalid metadata key "${key}": keys must be non-empty and must not contain "="`,
      );
    }
  }

  // `-map 0` keeps every stream (extra audio tracks, subtitles…) which the
  // default stream selection would otherwise drop on a copy.
  const args = [
    '-i',
    input,
    '-map',
    '0',
    '-c',
    'copy',
    ...buildMetadataArgs({ tags, clear }),
    '-y',
    output,
  ];

  await spawnFFmpeg({
    binary: resolveBinary('ffmpeg'),
    args,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}
