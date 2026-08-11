/**
 * Cache tag for the legislation-types read cache served by
 * `GET /api/game/legislation-types`.
 *
 * Tagging the `unstable_cache` entry is cheap metadata and lets us add precise
 * `revalidateTag`-based invalidation later. Today the cache relies on a short
 * TTL plus the admin editor's `nocache=1` bypass for freshness — legislation
 * types are near-static (written only by admin seed / law-type edit routes), so
 * a few minutes of staleness for other clients is acceptable.
 */
export const LEGISLATION_TYPES_CACHE_TAG = "legislation-types";
