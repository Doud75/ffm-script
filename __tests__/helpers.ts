import { join } from 'node:path';

/**
 * Committed test fixture: 10s, 1280x720 @ 30fps h264 video + 440Hz aac audio,
 * with a keyframe every second (`-g 30`). Generated via FFmpeg, see
 * `fixtures/sample.mp4`. Jest runs from the project root, so resolve from cwd.
 */
export const SAMPLE = join(process.cwd(), 'fixtures', 'sample.mp4');
