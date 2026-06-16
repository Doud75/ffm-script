import { InvalidOptionsError } from '../errors/index.js';

/**
 * Parses a timestamp into seconds. Accepts a number of seconds, a numeric
 * string (`"5.5"`), or an `HH:MM:SS[.ms]` / `MM:SS` string.
 *
 * @param value - The timestamp to parse.
 * @param label - Name of the option, used in error messages (e.g. `'start'`).
 * @throws {InvalidOptionsError} when the value cannot be parsed.
 */
export function parseTimestamp(value: number | string, label: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new InvalidOptionsError(`invalid ${label} timestamp: ${value}`);
    }
    return value;
  }

  const parts = value.split(':');
  let seconds = 0;
  for (const part of parts) {
    const n = Number(part);
    if (part === '' || Number.isNaN(n)) {
      throw new InvalidOptionsError(`invalid ${label} timestamp: "${value}"`);
    }
    seconds = seconds * 60 + n;
  }
  return seconds;
}
