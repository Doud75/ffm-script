import { access } from 'node:fs/promises';
import { extname } from 'node:path';
import { FileNotFoundError, InvalidFormatError } from '../errors/index.js';

/**
 * Validates an input file before any FFmpeg invocation.
 *
 * Rather than parsing FFmpeg's stderr to detect bad inputs, every operation
 * calls this up front to fail fast with a typed, actionable error.
 *
 * @param path - Path to the input file.
 * @param allowedExtensions - When provided, the file extension must match one
 * of these (case-insensitive), e.g. `['.mp4']`.
 * @throws {FileNotFoundError} when the file does not exist.
 * @throws {InvalidFormatError} when the extension is not in `allowedExtensions`.
 */
export async function validateInput(
  path: string,
  allowedExtensions?: string[],
): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new FileNotFoundError(path);
  }

  if (allowedExtensions === undefined) return;

  const ext = extname(path).toLowerCase();
  const allowed = allowedExtensions.map((e) => e.toLowerCase());

  if (!allowed.includes(ext)) {
    const list = allowed.join(', ');
    const reason =
      ext === ''
        ? `missing file extension (supported: ${list})`
        : `unsupported extension "${ext}" (supported: ${list})`;
    throw new InvalidFormatError(path, reason);
  }
}
