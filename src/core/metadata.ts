/** Inputs to {@link buildMetadataArgs}. */
export interface MetadataArgsParams {
  /** Tags to write, as `key: value` pairs. */
  tags: Record<string, string>;
  /** Drop all existing input metadata first (FFmpeg `-map_metadata -1`). */
  clear: boolean;
}

/**
 * Builds the FFmpeg metadata arguments for {@link setMetadata}. Pure (no I/O),
 * so it is unit-tested directly.
 *
 * `-map_metadata -1` (when `clear`) comes first so it wipes the input's tags
 * before the per-tag `-metadata key=value` entries re-add the requested ones —
 * otherwise the clear would also drop what we just set. Each tag becomes a single
 * `key=value` argv token, so values may contain spaces or `=` without escaping.
 */
export function buildMetadataArgs(params: MetadataArgsParams): string[] {
  const { tags, clear } = params;
  const args: string[] = [];
  if (clear) args.push('-map_metadata', '-1');
  for (const [key, value] of Object.entries(tags)) {
    args.push('-metadata', `${key}=${value}`);
  }
  return args;
}
