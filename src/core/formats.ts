/** Video container extensions accepted as input (v0.2). */
export const VIDEO_INPUT_FORMATS: string[] = ['.mp4', '.mov', '.webm', '.mkv'];

/** Audio-only container extensions accepted as input (v0.2). */
export const AUDIO_INPUT_FORMATS: string[] = ['.mp3', '.aac', '.wav', '.flac', '.m4a'];

/** Image extensions accepted as an overlay / watermark source. */
export const IMAGE_INPUT_FORMATS: string[] = ['.png', '.jpg', '.jpeg', '.webp'];

/** Subtitle file extensions the library reads (burn-in source) and writes (extraction). */
export const SUBTITLE_FORMATS: string[] = ['.srt', '.vtt', '.ass'];

/** Every input format the library can read (video or audio). */
export const ALL_INPUT_FORMATS: string[] = [...VIDEO_INPUT_FORMATS, ...AUDIO_INPUT_FORMATS];
