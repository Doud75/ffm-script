/** Video container extensions accepted as input (v0.2). */
export const VIDEO_INPUT_FORMATS: string[] = ['.mp4', '.mov', '.webm', '.mkv'];

/** Audio-only container extensions accepted as input (v0.2). */
export const AUDIO_INPUT_FORMATS: string[] = ['.mp3', '.aac', '.wav', '.flac', '.m4a'];

/** Every input format the library can read (video or audio). */
export const ALL_INPUT_FORMATS: string[] = [...VIDEO_INPUT_FORMATS, ...AUDIO_INPUT_FORMATS];
