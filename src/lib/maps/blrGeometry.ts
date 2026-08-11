/**
 * The Byelorussian SSR's six oblasts, keyed by region code (= the game's
 * `states._id`). Ownership is read live from `states.countryId`. The shard
 * `public/blr-regions.json` is built by `scripts/maps/build-blr-geo.mjs`
 * (geoBoundaries BLR ADM1 dissolved through one topology, Minsk City folded
 * into Minsk oblast because the city is an enclave inside it and a separate
 * one-dot region would carry a third of the republic's politics), features
 * tagged `properties.regionCode` plus the legacy `id`/`na` other surfaces read.
 * Same code set in the 1953 and 1979 presets — one shard, no era variant.
 *
 * The codes carry the `BLR_` country prefix because Byelorussia is listed in
 * `PREFIXED_REGION_ID_COUNTRIES` (src/lib/constants/countries.ts): region `_id`s
 * live in one global `states._id` namespace and compactRegionCode /
 * canonicalRegionId round-trip on the `<CountryId>_` stem. Renaming these means
 * rebuilding the shard through scripts/maps/build-blr-geo.mjs, which writes the
 * same codes.
 */
export const BLR_GEO_URL = "/blr-regions.json";

export const BLR_REGION_CODES = [
  "BLR_BRE",
  "BLR_GRO",
  "BLR_HOM",
  "BLR_MIN",
  "BLR_MOG",
  "BLR_VIT",
] as const;

/** Compact on-map labels — the long names overflow the small map tiles. */
export const BLR_LABEL_OVERRIDES: Record<string, string> = {
  BLR_MIN: "Minsk",
  BLR_BRE: "Brest",
  BLR_HOM: "Gomel",
  BLR_GRO: "Grodno",
  BLR_MOG: "Mogilev",
  BLR_VIT: "Vitebsk",
};

export function isByelorussiaRegion(code: string): boolean {
  return (BLR_REGION_CODES as readonly string[]).includes(code);
}
