import { join } from 'node:path';
import { buildAudioHLSArgs, buildVideoHLSArgs } from '../src/core/hls.js';

// Pure arg-builder tests: no FFmpeg, no filesystem — assert the exact argv the
// builders hand to `spawnFFmpeg`. `join` keeps the segment/playlist paths
// platform-correct, so compare against `join(...)` rather than literals.

describe('buildVideoHLSArgs', () => {
  const resolutions = [
    { width: 640, bitrate: '800k' },
    { width: 320, bitrate: '400k' },
  ];

  it('splits and scales one variant per resolution, muxing audio when present', () => {
    const args = buildVideoHLSArgs('in.mp4', 'out', resolutions, 6, true, 'ts');

    expect(args.slice(0, 4)).toEqual([
      '-i',
      'in.mp4',
      '-filter_complex',
      '[0:v]split=2[v0][v1]; [v0]scale=w=640:h=-2[v0out]; [v1]scale=w=320:h=-2[v1out]',
    ]);
    // One video map per variant, plus one audio map per variant when audio exists.
    expect(args).toEqual(expect.arrayContaining(['-map', '[v0out]', '-c:v:0', 'libx264']));
    expect(args.filter((a) => a === '-map')).toHaveLength(4);
    const vsm = args[args.indexOf('-var_stream_map') + 1];
    expect(vsm).toBe('v:0,a:0,name:640 v:1,a:1,name:320');
  });

  it('omits the audio maps when the source has none', () => {
    const args = buildVideoHLSArgs('in.mp4', 'out', resolutions, 6, false, 'ts');

    expect(args).not.toContain('a:0');
    expect(args.filter((a) => a === '-map')).toHaveLength(2);
    const vsm = args[args.indexOf('-var_stream_map') + 1];
    expect(vsm).toBe('v:0,name:640 v:1,name:320');
  });

  it('uses the explicit variant name when provided', () => {
    const args = buildVideoHLSArgs(
      'in.mp4',
      'out',
      [{ width: 640, bitrate: '800k', name: 'hi' }],
      6,
      false,
      'ts',
    );
    expect(args[args.indexOf('-var_stream_map') + 1]).toBe('v:0,name:hi');
  });

  it('emits MPEG-TS segments by default (no fmp4 flags)', () => {
    const args = buildVideoHLSArgs('in.mp4', 'out', resolutions, 4, true, 'ts');

    expect(args).toEqual(
      expect.arrayContaining([
        '-hls_segment_filename',
        join('out', '%v', 'segment_%03d.ts'),
        '-hls_time',
        '4',
      ]),
    );
    expect(args).not.toContain('-hls_segment_type');
    expect(args).not.toContain('-hls_fmp4_init_filename');
    expect(args[args.length - 1]).toBe(join('out', '%v', 'playlist.m3u8'));
  });

  it('emits fMP4/CMAF segments and an init segment when segmentType is fmp4', () => {
    const args = buildVideoHLSArgs('in.mp4', 'out', resolutions, 6, true, 'fmp4');

    expect(args).toEqual(
      expect.arrayContaining([
        '-hls_segment_filename',
        join('out', '%v', 'segment_%03d.m4s'),
        '-hls_segment_type',
        'fmp4',
        '-hls_fmp4_init_filename',
        'init.mp4',
      ]),
    );
    expect(args).not.toContain(join('out', '%v', 'segment_%03d.ts'));
  });
});

describe('buildAudioHLSArgs', () => {
  it('builds a single AAC variant with no filtergraph or scaling', () => {
    const args = buildAudioHLSArgs('in.m4a', 'out', ['128k'], 6, 'ts');

    expect(args.slice(0, 2)).toEqual(['-i', 'in.m4a']);
    expect(args).not.toContain('-filter_complex');
    expect(args.some((a) => a.includes('scale'))).toBe(false);
    expect(args.some((a) => a.includes('[0:v]'))).toBe(false);
    expect(args).toEqual(
      expect.arrayContaining(['-map', '0:a', '-c:a:0', 'aac', '-b:a:0', '128k']),
    );
    expect(args[args.indexOf('-var_stream_map') + 1]).toBe('a:0,name:128k');
    expect(args[args.length - 1]).toBe(join('out', '%v', 'playlist.m3u8'));
  });

  it('builds one AAC variant per bitrate, named by the bitrate', () => {
    const args = buildAudioHLSArgs('in.m4a', 'out', ['128k', '64k'], 6, 'ts');

    expect(args.filter((a) => a === '-map')).toHaveLength(2);
    expect(args).toEqual(expect.arrayContaining(['-b:a:0', '128k', '-b:a:1', '64k']));
    expect(args[args.indexOf('-var_stream_map') + 1]).toBe('a:0,name:128k a:1,name:64k');
  });

  it('emits MPEG-TS segments by default (no fmp4 flags)', () => {
    const args = buildAudioHLSArgs('in.m4a', 'out', ['128k'], 6, 'ts');

    expect(args).toContain(join('out', '%v', 'segment_%03d.ts'));
    expect(args).not.toContain('-hls_segment_type');
  });

  it('emits fMP4/CMAF segments and an init segment when segmentType is fmp4', () => {
    const args = buildAudioHLSArgs('in.m4a', 'out', ['128k', '64k'], 6, 'fmp4');

    expect(args).toEqual(
      expect.arrayContaining([
        '-hls_segment_filename',
        join('out', '%v', 'segment_%03d.m4s'),
        '-hls_segment_type',
        'fmp4',
        '-hls_fmp4_init_filename',
        'init.mp4',
      ]),
    );
  });
});
