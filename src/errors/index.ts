export class FfmScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FfmScriptError';
  }
}

export class FFmpegNotFoundError extends FfmScriptError {
  constructor(binary: 'ffmpeg' | 'ffprobe' = 'ffmpeg', invalidEnvPath?: string) {
    const envVar = binary === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH';
    const cause =
      invalidEnvPath !== undefined
        ? `${envVar} is set to "${invalidEnvPath}", but no executable was found there.`
        : `"${binary}" was not found in your PATH.`;
    super(
      `${cause}\n` +
        `Set ${envVar} to the binary's absolute path, or install FFmpeg:\n` +
        `  macOS:   brew install ffmpeg\n` +
        `  Ubuntu:  sudo apt-get install ffmpeg\n` +
        `  Windows: winget install Gyan.FFmpeg\n` +
        `  Other:   https://ffmpeg.org/download.html`,
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
