/**
 * Ukraine's six macro-regions (Kyiv and the Right Bank, Western Ukraine,
 * Podolia, Donbas, the Dnieper industrial belt, the Black Sea coast), keyed by
 * region code (= the game's `states._id`). Ownership is read live from
 * `states.countryId`. The shard `public/ua-regions.json` is built by
 * `scripts/maps/build-ua-geo.mjs` (UKR oblasts dissolved through one topology),
 * features tagged `properties.regionCode` plus the legacy `id`/`na` other
 * surfaces read. Same code set in the 1953 and 1979 presets - one shard, no era
 * variant.
 *
 * Codes carry the `UKR_` country prefix (Ukraine is in
 * PREFIXED_REGION_ID_COUNTRIES) because `states._id` is one global namespace and
 * compactRegionCode/canonicalRegionId round-trip on that prefix.
 *
 * Note that the southern polygon includes Crimea, which was an RSFSR oblast
 * until February 1954. The 1953 preset's population and output for UKR_SOU are
 * sized for the mainland coastal oblasts; the geometry is drawn on the
 * post-1954 republic so one shard serves both eras.
 */
export const UA_GEO_URL = "/ua-regions.json";

export const UA_REGION_CODES = [
  "UKR_DNI",
  "UKR_DON",
  "UKR_KYI",
  "UKR_POD",
  "UKR_SOU",
  "UKR_WES",
] as const;

/** Compact on-map labels - the long names overflow the small map tiles. */
export const UA_LABEL_OVERRIDES: Record<string, string> = {
  UKR_KYI: "Kyiv",
  UKR_WES: "West",
  UKR_POD: "Podolia",
  UKR_DON: "Donbas",
  UKR_DNI: "Dnieper",
  UKR_SOU: "South",
};

export function isUkraineRegion(code: string): boolean {
  return (UA_REGION_CODES as readonly string[]).includes(code);
}
