import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probe } from '../src/operations/probe.js';
import { convert } from '../src/operations/convert.js';
import { InvalidFormatError } from '../src/errors/index.js';
import { SAMPLE } from './helpers.js';

describe('v0.2 input formats', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ffm-formats-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Remuxes the committed MP4 fixture into another container (no re-encode). */
  function remux(ext: string): string {
    const out = join(dir, `sample${ext}`);
    execFileSync('ffmpeg', ['-i', SAMPLE, '-c', 'copy', '-y', out], { stdio: 'ignore' });
    return out;
  }

  it('probes a MKV input', async () => {
    const info = await probe(remux('.mkv'));
    expect(info.video?.codec).toBe('h264');
  }, 30_000);

  it('converts a MOV input to MP4', async () => {
    const output = join(dir, 'out.mp4');
    await convert(remux('.mov'), output);
    expect((await probe(output)).video?.codec).toBe('h264');
  }, 30_000);

  it('rejects an unsupported input extension', async () => {
    const avi = join(dir, 'x.avi');
    writeFileSync(avi, ''); // must exist so the extension check (not existence) fails
    await expect(probe(avi)).rejects.toBeInstanceOf(InvalidFormatError);
  });
});
