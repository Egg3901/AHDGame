/**
 * Hungary's three macro-regions (Central Hungary, Transdanubia, Great Plain &
 * North), keyed by region code (= the game's `states._id`). Ownership is read
 * live from `states.countryId`. The shard `public/hu-regions.json` is built
 * by `scripts/maps/build-hu-geo.mjs` (HUN megyék dissolved through one
 * topology), features tagged `properties.regionCode` plus the legacy `id`/`na`
 * other surfaces read. Same code set in the 1953 and 1979 presets — one
 * shard, no era variant.
 */
export const HU_GEO_URL = "/hu-regions.json";

export const HU_REGION_CODES = [
  "HU_ALF",
  "HU_BUD",
  "HU_NOR",
  "HU_PES",
  "HU_TRS",
  "HU_TRW",
] as const;

/** Compact on-map labels — the long names overflow the small map tiles. */
export const HU_LABEL_OVERRIDES: Record<string, string> = {
  HU_ALF: "Great Plain",
  HU_BUD: "Bp.",
  HU_NOR: "North",
  HU_TRS: "S. Transdan.",
  HU_TRW: "W. Transdan.",
};

export function isHungaryRegion(code: string): boolean {
  return (HU_REGION_CODES as readonly string[]).includes(code);
}
