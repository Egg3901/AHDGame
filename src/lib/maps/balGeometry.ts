/**
 * The three Baltic union republics (Estonia, Latvia, Lithuania), keyed by
 * region code (= the game's `states._id`). Ownership is read live from
 * `states.countryId`. The shard `public/bal-regions.json` carries one feature
 * per republic, tagged `properties.regionCode` plus the legacy `id`/`na` other
 * surfaces read. Same code set in the 1953 and 1979 presets — one shard, no era
 * variant, because the republican borders did not move between the two.
 *
 * These ids replaced the old single `BAL_BAL` blob region; nothing should refer
 * to `BAL_BAL` any more.
 */
export const BAL_GEO_URL = "/bal-regions.json";

export const BAL_REGION_CODES = ["BAL_EST", "BAL_LVA", "BAL_LTU"] as const;

/**
 * Compact on-map labels. The three republics are small and sit side by side on
 * the map tile, so the full names collide; the standard three-letter forms are
 * unambiguous to anyone looking at the region.
 */
export const BAL_LABEL_OVERRIDES: Record<string, string> = {
  BAL_EST: "Est",
  BAL_LVA: "Lat",
  BAL_LTU: "Lith",
};

export function isBalticRegion(code: string): boolean {
  return (BAL_REGION_CODES as readonly string[]).includes(code);
}
