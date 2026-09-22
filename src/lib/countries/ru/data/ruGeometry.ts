/**
 * USSR macro-region geometry, keyed by region code. The single source for the
 * Soviet Union on the generic `RegionalGeoMap` — region identity is the code (=
 * the game's `states._id`), and which country it renders under is read live from
 * `states.countryId`. The USSR is seeded in the 1953 and 1979 presets.
 *
 * The shard is `public/ru-regions.json`, built by `scripts/maps/build-ru-geo.mjs`
 * (10 RSFSR economic regions dissolved from Russian federal subjects + 4 union
 * republics from the world base map: KAZ, TRA, CAS, MOL). Ukraine, Byelorussia
 * and the Baltics used to be shipped in this shard; they are now their own
 * countries with their own shards (ua-regions.json, blr-regions.json,
 * bal-regions.json). Eastern longitudes are unwrapped past the
 * antimeridian (Far East lon > 180) so the territory is one contiguous span,
 * which suits the flat nation map; WorldMapSVG re-wraps the unioned blob for the
 * /world globe, where d3's orthographic expects −180..180.
 */
export const RU_GEO_URL = "/ru-regions.json";

/** The 14 region codes (= states._id). Order matches src/lib/seeds/ru/ruRegions.ts. */
export const RU_REGION_CODES = [
  "CEN",
  "NWR",
  "NOR",
  "CBE",
  "VOL",
  "NCA",
  "URA",
  "WSB",
  "ESB",
  "FEA",
  "KAZ",
  "TRA",
  "CAS",
  "MOL",
] as const;

/** Compact on-map labels — the full region names overflow the small tiles. */
export const RU_LABEL_OVERRIDES: Record<string, string> = {
  CEN: "C. Russia",
  NWR: "NW Russia",
  NOR: "Eur. North",
  CBE: "Black Earth",
  VOL: "Volga",
  NCA: "N. Caucasus",
  URA: "Urals",
  WSB: "W. Siberia",
  ESB: "E. Siberia",
  FEA: "Far East",
  KAZ: "Kazakhstan",
  TRA: "Transcaucasia",
  CAS: "C. Asia",
  MOL: "Moldova",
};

export function isSovietRegion(code: string): boolean {
  return (RU_REGION_CODES as readonly string[]).includes(code);
}
