import { parseTimestamp } from '../src/core/time.js';
import { InvalidOptionsError } from '../src/errors/index.js';

describe('parseTimestamp', () => {
  it('returns a finite number unchanged', () => {
    expect(parseTimestamp(5.5, 'start')).toBe(5.5);
    expect(parseTimestamp(0, 'start')).toBe(0);
  });

  it('rejects a non-finite number', () => {
    expect(() => parseTimestamp(Infinity, 'start')).toThrow(InvalidOptionsError);
    expect(() => parseTimestamp(Number.NaN, 'end')).toThrow(/invalid end timestamp/);
  });

  it('parses a numeric string as seconds', () => {
    expect(parseTimestamp('12.25', 'start')).toBe(12.25);
  });

  it('parses MM:SS', () => {
    expect(parseTimestamp('01:30', 'start')).toBe(90);
  });

  it('parses HH:MM:SS[.ms]', () => {
    expect(parseTimestamp('01:02:03', 'end')).toBe(3723);
    expect(parseTimestamp('00:00:30.5', 'end')).toBe(30.5);
  });

  it('rejects an empty component', () => {
    expect(() => parseTimestamp('01::30', 'start')).toThrow(InvalidOptionsError);
    expect(() => parseTimestamp('', 'start')).toThrow(InvalidOptionsError);
  });

  it('rejects a non-numeric component', () => {
    expect(() => parseTimestamp('01:ab', 'start')).toThrow(/invalid start timestamp/);
  });
});
