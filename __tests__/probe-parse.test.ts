import { parseProbeOutput } from '../src/operations/probe.js';
import { InvalidFormatError } from '../src/errors/index.js';

const FILE = 'video.mp4';

/** Builds an ffprobe JSON payload from partial stream/format fragments. */
function payload(streams: unknown[], format: unknown = {}): string {
  return JSON.stringify({ streams, format });
}

describe('parseProbeOutput', () => {
  it('maps format and stream fields', () => {
    const result = parseProbeOutput(
      FILE,
      payload(
        [
          {
            index: 0,
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            avg_frame_rate: '30/1',
            bit_rate: '5000000',
          },
          {
            index: 1,
            codec_type: 'audio',
            codec_name: 'aac',
            sample_rate: '48000',
            channels: 2,
            bit_rate: '192000',
          },
        ],
        { duration: '124.5', size: '10485760', bit_rate: '5200000' },
      ),
    );

    expect(result.duration).toBe(124.5);
    expect(result.size).toBe(10485760);
    expect(result.bitrate).toBe(5200000);
    expect(result.streams).toHaveLength(2);
    expect(result.video).toMatchObject({
      codec: 'h264',
      width: 1920,
      height: 1080,
      fps: 30,
      bitrate: 5000000,
      rotation: 0,
    });
    expect(result.audio).toMatchObject({
      codec: 'aac',
      sampleRate: 48000,
      channels: 2,
      bitrate: 192000,
    });
  });

  it('reads rotation from the Display Matrix side data, normalized to [0, 360)', () => {
    const result = parseProbeOutput(
      FILE,
      payload([
        {
          codec_type: 'video',
          side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }],
        },
      ]),
    );

    expect(result.video?.rotation).toBe(270);
  });

  it('falls back to the legacy rotate tag', () => {
    const result = parseProbeOutput(
      FILE,
      payload([{ codec_type: 'video', tags: { rotate: '90' } }]),
    );

    expect(result.video?.rotation).toBe(90);
  });

  it('computes fps from a rational frame rate', () => {
    const result = parseProbeOutput(
      FILE,
      payload([{ codec_type: 'video', avg_frame_rate: '30000/1001' }]),
    );

    expect(result.video?.fps).toBeCloseTo(29.97, 2);
  });

  it('returns null video/audio when streams are absent', () => {
    const result = parseProbeOutput(FILE, payload([{ codec_type: 'data' }]));

    expect(result.video).toBeNull();
    expect(result.audio).toBeNull();
    expect(result.streams[0]?.type).toBe('data');
  });

  it('throws InvalidFormatError on unparseable output', () => {
    expect(() => parseProbeOutput(FILE, 'not json')).toThrow(InvalidFormatError);
  });
});
