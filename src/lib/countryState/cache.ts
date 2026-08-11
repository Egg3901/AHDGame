import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CountryState } from "@/lib/db/types/countryState";

/**
 * Per-Db-instance memo for CountryState reads. In serverless / per-request
 * DB connections each request gets its own Db handle and therefore its own
 * cache slot; GC cleans it up when the request ends.
 */
const cache = new WeakMap<Db, Map<CountryId, CountryState>>();

export function getCachedCountryState(db: Db, countryId: CountryId): CountryState | undefined {
  return cache.get(db)?.get(countryId);
}

export function setCachedCountryState(db: Db, state: CountryState): void {
  let bucket = cache.get(db);
  if (!bucket) {
    bucket = new Map();
    cache.set(db, bucket);
  }
  bucket.set(state.countryId, state);
}

export function invalidateCachedCountryState(db: Db, countryId: CountryId): void {
  cache.get(db)?.delete(countryId);
}

/** Test-only: nuke the cache for a Db instance. */
export function clearCountryStateCacheForDb(db: Db): void {
  cache.delete(db);
}
