/**
 * Escapes a path so it survives FFmpeg's filtergraph parser when used as the
 * `subtitles` filter's source. Inside a filtergraph `\` is the escape char, `:`
 * separates filter options and `'` quotes values — an unescaped one in a path
 * would truncate the filter or shift its arguments. Backslash is escaped first so
 * the escapes added afterwards aren't doubled.
 */
export function escapeSubtitlesPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/**
 * Builds the `subtitles` video filter that renders subtitles onto the frame.
 *
 * @param source - Path to read subtitles from: an external file, or the input
 * video itself when burning an embedded track.
 * @param track - Embedded subtitle stream index (`si=`) to render. Omit for an
 * external file, which carries a single stream.
 */
export function buildSubtitlesFilter(source: string, track?: number): string {
  const escaped = escapeSubtitlesPath(source);
  return track !== undefined ? `subtitles=${escaped}:si=${track}` : `subtitles=${escaped}`;
}
