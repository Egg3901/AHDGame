/**
 * Finland's six macro-regions, keyed by region code (= the game's
 * `states._id`). Ownership is read live from `states.countryId`. The shard
 * `public/fi-regions.json` is built by `scripts/maps/build-fi-geo.mjs`
 * (19 maakunta dissolved through one shared topology), features tagged
 * `properties.regionCode` plus the legacy `id`/`na` other surfaces read.
 * Same code set in the 1953 and 1979 presets — one shard, no era variant.
 */
export const FI_GEO_URL = "/fi-regions.json";

export const FI_REGION_CODES = ["FI_EAS", "FI_HAM", "FI_LAP", "FI_OST", "FI_SW", "FI_UUS"] as const;

/** Compact on-map labels — the long names overflow the small map tiles. */
export const FI_LABEL_OVERRIDES: Record<string, string> = {
  FI_UUS: "Uusimaa",
  FI_SW: "Southwest",
  FI_HAM: "Häme",
  FI_EAS: "East",
  FI_OST: "Ostrobothnia",
  FI_LAP: "Lapland",
};

export function isFinlandRegion(code: string): boolean {
  return (FI_REGION_CODES as readonly string[]).includes(code);
}
