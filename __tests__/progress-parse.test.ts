import { parseProgress } from '../src/core/spawn.js';

describe('parseProgress', () => {
  it('returns null when the line carries no time= field', () => {
    expect(parseProgress('frame=1 fps=30 speed=1.0x', 10)).toBeNull();
  });

  it('parses percent and currentTime from time=', () => {
    expect(parseProgress('time=00:00:05.00', 10)).toMatchObject({
      percent: 50,
      currentTime: 5,
      totalTime: 10,
    });
  });

  it('handles hours, minutes and centiseconds', () => {
    const p = parseProgress('time=01:02:03.50', 7323.5);
    expect(p?.currentTime).toBeCloseTo(3723.5);
  });

  it('clamps percent to 100 past the end', () => {
    expect(parseProgress('time=00:00:12.00', 10)?.percent).toBe(100);
  });

  it('enriches with fps, speed and bitrate (converted to bits/s)', () => {
    const line =
      'frame= 120 fps= 30 q=28.0 size= 512kB time=00:00:04.00 bitrate= 524.3kbits/s speed=1.5x';
    expect(parseProgress(line, 8)).toMatchObject({
      percent: 50,
      currentTime: 4,
      fps: 30,
      speed: 1.5,
      bitrate: 524300,
    });
  });

  it('derives eta from the remaining duration and speed', () => {
    // 6s left at 2x realtime → 3s remaining.
    expect(parseProgress('time=00:00:04.00 speed=2.0x', 10)?.eta).toBeCloseTo(3);
  });

  it('omits fields FFmpeg reports as N/A on the first frames', () => {
    const p = parseProgress('frame=0 fps=0.0 time=00:00:00.00 bitrate=N/A speed=N/A', 10);
    expect(p).not.toBeNull();
    expect(p).not.toHaveProperty('speed');
    expect(p).not.toHaveProperty('bitrate');
    expect(p).not.toHaveProperty('eta');
    // fps=0.0 is a real (parseable) value, unlike the N/A fields.
    expect(p?.fps).toBe(0);
  });

  it('omits eta when speed is zero', () => {
    const p = parseProgress('time=00:00:00.00 speed=0.0x', 10);
    expect(p).not.toHaveProperty('eta');
    expect(p?.speed).toBe(0);
  });
});
