import { buildFilterGraph } from '../src/core/filtergraph.js';
import type { OverlayFilterParams } from '../src/core/overlay.js';

const WATERMARK: OverlayFilterParams = {
  position: 'bottom-right',
  margin: 10,
  opacity: 1,
  width: undefined,
};

describe('buildFilterGraph', () => {
  it('returns no arguments for an empty spec', () => {
    expect(buildFilterGraph({})).toEqual([]);
    expect(
      buildFilterGraph({ scale: undefined, subtitles: undefined, overlay: undefined }),
    ).toEqual([]);
  });

  describe('without an overlay (single input → -vf)', () => {
    it('emits a lone scale exactly as callers built it before', () => {
      expect(buildFilterGraph({ scale: 'scale=1280:-2' })).toEqual(['-vf', 'scale=1280:-2']);
    });

    it('emits a lone subtitles filter', () => {
      expect(buildFilterGraph({ subtitles: 'subtitles=/tmp/subs.srt' })).toEqual([
        '-vf',
        'subtitles=/tmp/subs.srt',
      ]);
    });

    it('chains scale then subtitles, in that order', () => {
      expect(
        buildFilterGraph({ scale: 'scale=640:-2', subtitles: 'subtitles=/tmp/subs.srt' }),
      ).toEqual(['-vf', 'scale=640:-2,subtitles=/tmp/subs.srt']);
    });
  });

  describe('with an overlay (second input → -filter_complex)', () => {
    it('reads [0:v] directly when there is no other filter', () => {
      expect(buildFilterGraph({ overlay: WATERMARK })).toEqual([
        '-filter_complex',
        '[0:v][1:v]overlay=W-w-10:H-h-10[out]',
        '-map',
        '[out]',
        '-map',
        '0:a?',
      ]);
    });

    it('stacks the watermark on top of the scale + subtitles stage', () => {
      expect(
        buildFilterGraph({
          scale: 'scale=640:-2',
          subtitles: 'subtitles=/tmp/subs.srt',
          overlay: WATERMARK,
        }),
      ).toEqual([
        '-filter_complex',
        '[0:v]scale=640:-2,subtitles=/tmp/subs.srt[base];[base][1:v]overlay=W-w-10:H-h-10[out]',
        '-map',
        '[out]',
        '-map',
        '0:a?',
      ]);
    });

    it('keeps the watermark’s own filters on its [1:v] branch', () => {
      const [, graph] = buildFilterGraph({
        scale: 'scale=640:-2',
        overlay: { position: 'center', margin: 0, opacity: 0.5, width: 80 },
      });

      expect(graph).toBe(
        '[0:v]scale=640:-2[base];' +
          '[1:v]format=rgba,colorchannelmixer=aa=0.5,scale=80:-1[wm];' +
          '[base][wm]overlay=(W-w)/2:(H-h)/2[out]',
      );
    });

    it('always exposes the result as [out] and keeps the audio optional', () => {
      for (const spec of [
        { overlay: WATERMARK },
        { scale: 'scale=320:-2', overlay: WATERMARK },
        { subtitles: 'subtitles=/tmp/s.srt', overlay: WATERMARK },
      ]) {
        const args = buildFilterGraph(spec);
        expect(args[1]).toContain('[out]');
        expect(args.slice(2)).toEqual(['-map', '[out]', '-map', '0:a?']);
      }
    });
  });
});
