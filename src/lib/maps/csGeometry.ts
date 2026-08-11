/**
 * Czechoslovakia's three historic lands (Bohemia, Moravia, Slovakia), keyed by
 * region code (= the game's `states._id`). Ownership is read live from
 * `states.countryId`. The shard `public/cs-regions.json` is built by
 * `scripts/maps/build-cs-geo.mjs` (SVK outline + CZE kraje partitioned into
 * the two Czech lands, dissolved through one topology), features tagged
 * `properties.regionCode` plus the legacy `id`/`na` other surfaces read. Same
 * code set in the 1953 and 1979 presets — one shard, no era variant.
 */
export const CS_GEO_URL = "/cs-regions.json";

export const CS_REGION_CODES = ["CS_BOH", "CS_MOR", "CS_PRG", "CS_SVK"] as const;

/** Compact on-map labels — the long names overflow the small map tiles. */
export const CS_LABEL_OVERRIDES: Record<string, string> = {
  CS_PRG: "Prg.",
};

export function isCzechoslovakiaRegion(code: string): boolean {
  return (CS_REGION_CODES as readonly string[]).includes(code);
}
