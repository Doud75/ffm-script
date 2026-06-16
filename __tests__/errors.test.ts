import {
  FfmScriptError,
  FFmpegNotFoundError,
  FileNotFoundError,
  InvalidFormatError,
  InvalidOptionsError,
  FFmpegError,
  FFmpegTimeoutError,
} from '../src/errors/index.js';

describe('typed errors', () => {
  const errors = [
    new FFmpegNotFoundError('ffmpeg'),
    new FileNotFoundError('/missing.mp4'),
    new InvalidFormatError('/x.txt', 'unsupported'),
    new InvalidOptionsError('bad option'),
    new FFmpegError('stderr output', 1),
    new FFmpegTimeoutError(1000),
  ];

  it('all extend Error and FfmScriptError, with a matching name and a message', () => {
    for (const err of errors) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(FfmScriptError);
      expect(err.name).toBe(err.constructor.name);
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  it('FFmpegError exposes readonly stderr and exitCode', () => {
    const err = new FFmpegError('boom', 2);
    expect(err.stderr).toBe('boom');
    expect(err.exitCode).toBe(2);
  });

  it('FFmpegTimeoutError exposes the timeout duration', () => {
    expect(new FFmpegTimeoutError(5000).duration).toBe(5000);
  });

  it('FFmpegNotFoundError includes install guidance and the right env var', () => {
    expect(new FFmpegNotFoundError('ffprobe').message).toMatch(/FFPROBE_PATH/);
    expect(new FFmpegNotFoundError('ffmpeg').message).toMatch(/ffmpeg\.org\/download/);
  });
});
