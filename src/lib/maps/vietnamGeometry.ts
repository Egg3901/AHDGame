/**
 * The two Vietnams, split at the 17th parallel by
 * `scripts/maps/build-vietnam-geo.mjs`.
 *
 * NOT a region shard, and deliberately outside `REGION_SHARDS`. Every entry
 * there is drawn by unioning regions whose OWNER is read from `states`, and
 * `states` holds only the full-autonomous countries — NVN and SVN are
 * sphere-macro, so ownership could never resolve for them without promoting both
 * to full countries. These are static features instead, claimed outright by
 * `mapFeatureIds`, exactly as Thailand claims 764 and Laos claims 418.
 *
 * The partition is a latitude rather than a set of provinces, which is why there
 * is no source subdivision file to assemble from the way Germany has its Länder.
 */
export const VIETNAM_GEO_URL = "/vietnam-regions.json";

/**
 * The feature ids this file supplies. They are ENTITY KEYS, not ISO numerics —
 * unified Vietnam's 704 covers both halves and so can identify neither.
 */
export const VIETNAM_FEATURE_IDS = ["NVN", "SVN"] as const;

/**
 * The basemap feature these two replace. Drawn by nothing once they load: 704 is
 * unified Vietnam, which does not exist in 1953 and would sit underneath both
 * halves as an uncoloured background country.
 */
export const VIETNAM_BASE_FEATURE_ID = "704";
