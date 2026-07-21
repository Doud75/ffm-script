import { join } from 'node:path';
import type { HLSResolution, SegmentType } from '../types/index.js';

/** Audio track bitrate muxed alongside each video variant. */
const AUDIO_BITRATE = '128k';

/**
 * FFmpeg args that select the segment container, shared by the video and audio
 * builders: the `-hls_segment_filename` template (with the right extension)
 * plus, for fMP4, the `-hls_segment_type` and `-hls_fmp4_init_filename` flags.
 * The init filename is relative to each variant folder, so it lands at
 * `%v/init.mp4`. Pure (no I/O), unit-tested directly.
 */
function segmentTypeArgs(segmentType: SegmentType, outputDir: string): string[] {
  const ext = segmentType === 'fmp4' ? 'm4s' : 'ts';
  const args = ['-hls_segment_filename', join(outputDir, '%v', `segment_%03d.${ext}`)];
  if (segmentType === 'fmp4') {
    args.push('-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4');
  }
  return args;
}

/**
 * Builds the FFmpeg args that package a video into an adaptive-bitrate HLS
 * ladder: one scaled variant per resolution (optionally muxing the source
 * audio), a `master.m3u8`, and per-variant `%v/playlist.m3u8` + segments.
 * Pure (no I/O, no spawn), unit-tested directly against its string output.
 */
export function buildVideoHLSArgs(
  input: string,
  outputDir: string,
  resolutions: HLSResolution[],
  segmentDuration: number,
  hasAudio: boolean,
  segmentType: SegmentType,
): string[] {
  // Split the source video into N streams and scale each to a target width.
  const split = `[0:v]split=${resolutions.length}${resolutions.map((_, i) => `[v${i}]`).join('')}`;
  const scales = resolutions.map((r, i) => `[v${i}]scale=w=${r.width}:h=-2[v${i}out]`);
  const filterComplex = [split, ...scales].join('; ');

  const args = ['-i', input, '-filter_complex', filterComplex];

  resolutions.forEach((r, i) => {
    args.push('-map', `[v${i}out]`, `-c:v:${i}`, 'libx264', `-b:v:${i}`, r.bitrate);
  });
  if (hasAudio) {
    resolutions.forEach((_, i) => {
      args.push('-map', 'a:0', `-c:a:${i}`, 'aac', `-b:a:${i}`, AUDIO_BITRATE);
    });
  }

  const varStreamMap = resolutions
    .map((r, i) => {
      const name = r.name ?? String(r.width);
      return hasAudio ? `v:${i},a:${i},name:${name}` : `v:${i},name:${name}`;
    })
    .join(' ');

  args.push(
    '-f',
    'hls',
    '-hls_time',
    String(segmentDuration),
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments',
    ...segmentTypeArgs(segmentType, outputDir),
    '-master_pl_name',
    'master.m3u8',
    '-var_stream_map',
    varStreamMap,
    '-y',
    join(outputDir, '%v', 'playlist.m3u8'),
  );

  return args;
}

/**
 * Builds the FFmpeg args that package an audio file into an adaptive-bitrate
 * HLS ladder: one AAC variant per bitrate, a `master.m3u8`, and per-variant
 * `%v/playlist.m3u8` + segments (the variant folder is named after the
 * bitrate). No filtergraph or scaling — the audio counterpart of
 * {@link buildVideoHLSArgs}. Pure (no I/O, no spawn), unit-tested directly.
 */
export function buildAudioHLSArgs(
  input: string,
  outputDir: string,
  bitrates: string[],
  segmentDuration: number,
  segmentType: SegmentType,
): string[] {
  const args = ['-i', input];

  bitrates.forEach((bitrate, i) => {
    args.push('-map', '0:a', `-c:a:${i}`, 'aac', `-b:a:${i}`, bitrate);
  });

  const varStreamMap = bitrates.map((bitrate, i) => `a:${i},name:${bitrate}`).join(' ');

  args.push(
    '-f',
    'hls',
    '-hls_time',
    String(segmentDuration),
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments',
    ...segmentTypeArgs(segmentType, outputDir),
    '-master_pl_name',
    'master.m3u8',
    '-var_stream_map',
    varStreamMap,
    '-y',
    join(outputDir, '%v', 'playlist.m3u8'),
  );

  return args;
}
