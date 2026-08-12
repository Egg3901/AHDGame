/**
 * Whole-territory outlines for the 1953 entities with no present-day equivalent,
 * built by `scripts/maps/build-historical-geo.mjs`.
 *
 * NOT a region shard, and deliberately outside `REGION_SHARDS` — for the same
 * reason the Vietnams are: every entry there is drawn by unioning regions whose
 * OWNER is read from `states`, and `states` holds only full-autonomous countries.
 * These are protectorates, trust territories and international zones, so ownership
 * could never resolve for them without promoting each to a full country. They are
 * static features instead, claimed outright by `mapFeatureIds`.
 *
 * Whole territories only, with no internal regions: each of these is sphere-macro
 * or historical-presence, and nothing in the game asks them for provinces.
 *
 * What is NOT here, and why:
 *  - An entity with an exact modern equivalent (Congo, Somalia, the Palestinian
 *    territories, Ruanda-Urundi) takes a `mapFeatureIds` proxy instead — the
 *    modern border IS the historical one, so authoring a shape would only add a
 *    worse copy of it.
 *  - Czechoslovakia, Yugoslavia and East Germany are drawn by their REGION shards
 *    through ownership, and are correctly reported unmapped by
 *    `getWorldEntityMapSnapshot` — see worldEntityMap.test.ts.
 *  - The Somalia Trust Territories read like the Italian south, but that record is
 *    defined as BOTH Somalilands as one entity — which is modern Somalia, so it
 *    takes the 706 proxy. Building the south alone would have matched its name
 *    while contradicting its definition.
 */
export const HISTORICAL_GEO_URL = "/historical-regions.json";

/**
 * The feature ids this file supplies. ENTITY KEYS, not ISO numerics: none of these
 * territories has an ISO numeric of its own, which is the whole reason the file
 * exists.
 */
export const HISTORICAL_FEATURE_IDS = [
  "SAAR",
  "FTT",
  "TNG",
  "ESH",
  "ZNZ",
  "TGB",
  "CMB",
  "ADN",
  "YD",
  "CZ",
  "TTPI",
] as const;

export type HistoricalFeatureId = (typeof HISTORICAL_FEATURE_IDS)[number];

/**
 * Territories that sit INSIDE a modern country's polygon.
 *
 * Unlike Vietnam — where the two halves replace unified Vietnam's `704` outright —
 * these overlay their host rather than replacing it: the Saar is drawn on top of
 * Germany, Zanzibar on top of Tanzania. Dropping the host would erase a country
 * that very much exists in 1953, so nothing is removed from the basemap for them.
 */
export const HISTORICAL_OVERLAYS_HOST = true;

/**
 * ⚠️ DRAW ORDER — these must be added LAST, after the region-overlay blobs.
 *
 * An overlay territory is only visible if it is painted after whatever it overlays,
 * and its host may be drawn TWICE: once as a base country polygon, and again as a
 * unioned region blob if that host has a shard. Added before the blobs, the two
 * whose host has one — Saarland is one of Germany's Länder (`SL` in
 * `WEST_DE_REGION_CODES`), Trieste sits inside Italy's macro-regions — were painted
 * over and vanished, while the other nine looked fine, so a partial check passes.
 *
 * Each map expresses "last" differently, and both must be kept that way:
 *  - `WorldMapSVG` draws from one ordered feature array — append after the overlay
 *    block, not merely after the base countries.
 *  - `OrgWorldMap` has no such array; draw order is insertion order into its path
 *    Map, and the blobs are inserted last — so path these after that loop instead
 *    of pushing them onto the feature list.
 *
 * ⚠️ Where that ordering actually shows, on /world: every entity here is tiered
 * `historical-presence` (128 of them in 1953), which `buildTierLookup` resolves to
 * BACKGROUND — and background features are merged into one silhouette painted
 * before any individual path. So in the structural modes (`none` / `blocs`, the
 * default) these are not separately visible however they are ordered. The ordering
 * governs the heatmap modes, where `tierLookup` is undefined and every feature is
 * drawn individually, and it governs `OrgWorldMap`, which has no tier system at all
 * and is where org-membership shading needs them. Making them separately visible in
 * the structural modes is a TIER decision, not an ordering one, and would mean
 * promoting a class of 128 that the merged layer exists to keep off the globe.
 */
