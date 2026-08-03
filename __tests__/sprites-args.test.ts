import {
  buildSpriteFilter,
  buildVtt,
  formatVttTimestamp,
  planSpriteCues,
  resolveTileHeight,
  spriteSheetName,
  spriteSheetPattern,
} from '../src/core/sprites.js';

describe('spriteSheetPattern / spriteSheetName', () => {
  it('pads indices to the width FFmpeg writes', () => {
    expect(spriteSheetPattern('jpg')).toBe('sprite_%03d.jpg');
    expect(spriteSheetName(0, 'jpg')).toBe('sprite_000.jpg');
    expect(spriteSheetName(7, 'png')).toBe('sprite_007.png');
    expect(spriteSheetName(123, 'webp')).toBe('sprite_123.webp');
  });

  it('keeps every digit past the padding width, like %03d does', () => {
    expect(spriteSheetName(1234, 'jpg')).toBe('sprite_1234.jpg');
  });
});

describe('resolveTileHeight', () => {
  it('preserves the aspect ratio of a landscape source', () => {
    expect(resolveTileHeight(1280, 720, 0, 160)).toBe(90);
  });

  it('preserves the aspect ratio of a portrait source', () => {
    expect(resolveTileHeight(720, 1280, 0, 160)).toBe(284);
  });

  it('swaps the dimensions of a rotated source, which is how it is displayed', () => {
    // A 1280x720 frame tagged 90° plays back as 720x1280.
    expect(resolveTileHeight(1280, 720, 90, 160)).toBe(284);
    expect(resolveTileHeight(1280, 720, 270, 160)).toBe(284);
    // 180° is displayed with the source dimensions.
    expect(resolveTileHeight(1280, 720, 180, 160)).toBe(90);
  });

  it('rounds to an even number', () => {
    // 100x33 at width 160 → 52.8 → 52, not 53.
    expect(resolveTileHeight(100, 33, 0, 160)).toBe(52);
    expect(resolveTileHeight(160, 91, 0, 160) % 2).toBe(0);
  });

  it('never goes below 2 pixels', () => {
    expect(resolveTileHeight(4000, 10, 0, 160)).toBe(2);
  });
});

describe('buildSpriteFilter', () => {
  it('chains fps, scale and tile', () => {
    expect(
      buildSpriteFilter({ interval: 10, tileWidth: 160, tileHeight: 90, columns: 5, rows: 5 }),
    ).toBe('fps=1/10,scale=160:90,tile=5x5');
  });

  it('accepts a fractional interval', () => {
    expect(
      buildSpriteFilter({ interval: 2.5, tileWidth: 320, tileHeight: 180, columns: 4, rows: 3 }),
    ).toBe('fps=1/2.5,scale=320:180,tile=4x3');
  });
});

describe('planSpriteCues', () => {
  const grid = { columns: 5, rows: 5, tileWidth: 160, tileHeight: 90 };

  it('returns nothing for a count of zero', () => {
    expect(planSpriteCues(0, { interval: 10, duration: 0, ...grid })).toEqual([]);
  });

  it('walks a row before dropping to the next one', () => {
    const cues = planSpriteCues(7, { interval: 10, duration: 70, ...grid });

    expect(cues[0]).toEqual({ start: 0, end: 10, sheetIndex: 0, x: 0, y: 0 });
    expect(cues[1]).toEqual({ start: 10, end: 20, sheetIndex: 0, x: 160, y: 0 });
    expect(cues[4]).toEqual({ start: 40, end: 50, sheetIndex: 0, x: 640, y: 0 });
    // Sixth thumbnail starts the second row.
    expect(cues[5]).toEqual({ start: 50, end: 60, sheetIndex: 0, x: 0, y: 90 });
    expect(cues[6]).toEqual({ start: 60, end: 70, sheetIndex: 0, x: 160, y: 90 });
  });

  it('spills onto a new sheet once the grid is full', () => {
    const cues = planSpriteCues(27, { interval: 1, duration: 27, ...grid });

    expect(cues[24]).toMatchObject({ sheetIndex: 0, x: 640, y: 360 });
    // The 26th thumbnail restarts at the top-left of the second sheet.
    expect(cues[25]).toMatchObject({ sheetIndex: 1, x: 0, y: 0 });
    expect(cues[26]).toMatchObject({ sheetIndex: 1, x: 160, y: 0 });
  });

  it('clips the last cue to the input duration', () => {
    const cues = planSpriteCues(2, { interval: 10, duration: 14.5, ...grid });

    expect(cues[1]).toMatchObject({ start: 10, end: 14.5 });
  });

  it('lays a single-column grid out vertically', () => {
    const cues = planSpriteCues(3, {
      interval: 5,
      duration: 15,
      columns: 1,
      rows: 3,
      tileWidth: 100,
      tileHeight: 60,
    });

    expect(cues.map((c) => c.y)).toEqual([0, 60, 120]);
    expect(cues.map((c) => c.x)).toEqual([0, 0, 0]);
  });
});

describe('formatVttTimestamp', () => {
  it('always emits hours, minutes, seconds and milliseconds', () => {
    expect(formatVttTimestamp(0)).toBe('00:00:00.000');
    expect(formatVttTimestamp(9.25)).toBe('00:00:09.250');
    expect(formatVttTimestamp(61.5)).toBe('00:01:01.500');
  });

  it('carries past the hour', () => {
    expect(formatVttTimestamp(3661.007)).toBe('01:01:01.007');
    expect(formatVttTimestamp(36_000)).toBe('10:00:00.000');
  });

  it('rounds to the millisecond', () => {
    expect(formatVttTimestamp(1.00049)).toBe('00:00:01.000');
    expect(formatVttTimestamp(1.0005)).toBe('00:00:01.001');
  });

  it('clamps a negative input to zero', () => {
    expect(formatVttTimestamp(-5)).toBe('00:00:00.000');
  });
});

describe('buildVtt', () => {
  it('renders a cue per thumbnail with its media fragment', () => {
    const cues = planSpriteCues(2, {
      interval: 10,
      duration: 15,
      columns: 5,
      rows: 5,
      tileWidth: 160,
      tileHeight: 90,
    });

    expect(buildVtt(cues, { tileWidth: 160, tileHeight: 90, format: 'jpg' })).toBe(
      [
        'WEBVTT',
        '',
        '00:00:00.000 --> 00:00:10.000',
        'sprite_000.jpg#xywh=0,0,160,90',
        '',
        '00:00:10.000 --> 00:00:15.000',
        'sprite_000.jpg#xywh=160,0,160,90',
        '',
      ].join('\n'),
    );
  });

  it('references the sheet the cue lives on, with the chosen format', () => {
    const vtt = buildVtt([{ start: 0, end: 4, sheetIndex: 2, x: 320, y: 180 }], {
      tileWidth: 160,
      tileHeight: 90,
      format: 'webp',
    });

    expect(vtt).toContain('sprite_002.webp#xywh=320,180,160,90');
  });

  it('emits a valid, empty document when there is no cue', () => {
    expect(buildVtt([], { tileWidth: 160, tileHeight: 90, format: 'png' })).toBe('WEBVTT\n');
  });
});
