import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateInput } from '../src/core/validate.js';
import { FileNotFoundError, InvalidFormatError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

describe('validateInput', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-validate-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves for an existing file when no extensions are required', async () => {
    await expect(validateInput(SAMPLE)).resolves.toBeUndefined();
  });

  it('throws FileNotFoundError for a missing file', async () => {
    await expect(validateInput(join(dir, 'nope.mp4'))).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('accepts an allowed extension case-insensitively', async () => {
    await expect(validateInput(SAMPLE, ['.MP4'])).resolves.toBeUndefined();
  });

  it('throws InvalidFormatError for an unsupported extension', async () => {
    await expect(validateInput(SAMPLE, ['.mov'])).rejects.toThrow(/unsupported extension "\.mp4"/);
  });

  it('throws InvalidFormatError with a "missing extension" reason for an extensionless path', async () => {
    const noExt = join(dir, 'clip');
    writeFileSync(noExt, 'x');
    await expect(validateInput(noExt, ['.mp4'])).rejects.toThrow(/missing file extension/);
    await expect(validateInput(noExt, ['.mp4'])).rejects.toBeInstanceOf(InvalidFormatError);
  });
});
