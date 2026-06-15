export class FfmScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FfmScriptError';
  }
}

export class FFmpegNotFoundError extends FfmScriptError {
  constructor(binary: 'ffmpeg' | 'ffprobe' = 'ffmpeg') {
    const envVar = binary === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH';
    super(
      `"${binary}" binary not found.\n` +
        `Set the ${envVar} environment variable to its path, or install ffmpeg:\n` +
        `  macOS:   brew install ffmpeg\n` +
        `  Ubuntu:  sudo apt-get install ffmpeg\n` +
        `  Windows: winget install Gyan.FFmpeg`,
    );
    this.name = 'FFmpegNotFoundError';
  }
}

export class FileNotFoundError extends FfmScriptError {
  constructor(path: string) {
    super(`File not found: ${path}`);
    this.name = 'FileNotFoundError';
  }
}

export class InvalidFormatError extends FfmScriptError {
  constructor(path: string, reason: string) {
    super(`Invalid format for "${path}": ${reason}`);
    this.name = 'InvalidFormatError';
  }
}

export class FFmpegError extends FfmScriptError {
  public readonly stderr: string;
  public readonly exitCode: number;

  constructor(stderr: string, exitCode: number) {
    super(`FFmpeg exited with code ${exitCode}:\n${stderr}`);
    this.name = 'FFmpegError';
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}
