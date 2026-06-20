import {
  resolveOutputContainer,
  assertCodecAllowed,
  isCrfFamily,
} from '../src/core/container.js';
import { InvalidFormatError } from '../src/errors/index.js';

describe('resolveOutputContainer', () => {
  it('maps each extension to its container and default codecs', () => {
    expect(resolveOutputContainer('out.mp4').container).toBe('mp4');
    expect(resolveOutputContainer('out.mov').container).toBe('mov');
    expect(resolveOutputContainer('out.mkv').container).toBe('mkv');

    const mp4 = resolveOutputContainer('clip.MP4'); // case-insensitive
    expect(mp4.config.defaultVideoCodec).toBe('libx264');
    expect(mp4.config.defaultAudioCodec).toBe('aac');

    const webm = resolveOutputContainer('clip.webm');
    expect(webm.container).toBe('webm');
    expect(webm.config.defaultVideoCodec).toBe('libvpx-vp9');
    expect(webm.config.defaultAudioCodec).toBe('libopus');
  });

  it('throws InvalidFormatError for an unsupported extension', () => {
    expect(() => resolveOutputContainer('out.avi')).toThrow(InvalidFormatError);
    expect(() => resolveOutputContainer('out.txt')).toThrow(InvalidFormatError);
    expect(() => resolveOutputContainer('out')).toThrow(InvalidFormatError);
  });
});

describe('assertCodecAllowed', () => {
  const webm = resolveOutputContainer('o.webm').config;
  const mp4 = resolveOutputContainer('o.mp4').config;
  const mkv = resolveOutputContainer('o.mkv').config;

  it('accepts a codec the container can carry', () => {
    expect(() => assertCodecAllowed(webm, 'libvpx-vp9', 'video', 'o.webm')).not.toThrow();
    expect(() => assertCodecAllowed(webm, 'libopus', 'audio', 'o.webm')).not.toThrow();
    expect(() => assertCodecAllowed(mp4, 'libx264', 'video', 'o.mp4')).not.toThrow();
  });

  it('rejects a known codec the container cannot carry', () => {
    expect(() => assertCodecAllowed(webm, 'libx264', 'video', 'o.webm')).toThrow(InvalidFormatError);
    expect(() => assertCodecAllowed(webm, 'aac', 'audio', 'o.webm')).toThrow(InvalidFormatError);
  });

  it('defers an unknown encoder to FFmpeg (no throw)', () => {
    expect(() => assertCodecAllowed(webm, 'h264_videotoolbox', 'video', 'o.webm')).not.toThrow();
    expect(() => assertCodecAllowed(mp4, 'some_future_encoder', 'video', 'o.mp4')).not.toThrow();
  });

  it("accepts anything for Matroska ('any')", () => {
    expect(() => assertCodecAllowed(mkv, 'libvpx-vp9', 'video', 'o.mkv')).not.toThrow();
    expect(() => assertCodecAllowed(mkv, 'libx264', 'video', 'o.mkv')).not.toThrow();
    expect(() => assertCodecAllowed(mkv, 'flac', 'audio', 'o.mkv')).not.toThrow();
  });
});

describe('isCrfFamily', () => {
  it('is true for x264/x265 encoders only', () => {
    expect(isCrfFamily('libx264')).toBe(true);
    expect(isCrfFamily('libx265')).toBe(true);
    expect(isCrfFamily('libvpx-vp9')).toBe(false);
    expect(isCrfFamily('libopus')).toBe(false);
  });
});
