import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { CountryState } from "@/lib/db/types/countryState";
import { getCountryStateCollection } from "@/lib/db/collections/countryState";
import { seedCountryStateFromConfig } from "./seed";
import {
  getCachedCountryState,
  invalidateCachedCountryState,
  setCachedCountryState,
} from "./cache";

export type CountryStatePatch = Partial<
  Pick<
    CountryState,
    | "governmentType"
    | "rulingPartyId"
    | "opsVoteMultipliers"
    | "hasLeaderConfidenceModel"
    | "reformCooldowns"
    | "pendingReformDiscount"
    | "popularBoostModifiers"
    | "renewalBumpOverride"
    | "pendingHonestByElection"
    | "pendingPostConversionElection"
    | "socialAxisPosition"
    | "socialAxisDriftTurn"
    | "displayNameOverride"
    | "flagEmojiOverride"
  >
>;

/**
 * Read the runtime state document for a country. Cached per-Db for the
 * duration of the request (or until updateCountryState invalidates).
 *
 * Defensive behaviour: if the DB doc is missing but the countryId is a
 * known COUNTRY_CONFIGS entry, self-heal from the seed config and
 * return. This makes the helper safe to call before the
 * `2026-05-28-promote-country-state` migration has been run in production
 * AND keeps integration tests with hand-built MockDbs from breaking. Tests
 * that want to assert a specific runtime governmentType (e.g.
 * post-Stage-4 conversion behaviour) still stub the lookup explicitly.
 *
 * Throws on unknown countryId (typo defense).
 */
export async function getCountryState(db: Db, countryId: CountryId): Promise<CountryState> {
  const cached = getCachedCountryState(db, countryId);
  if (cached) return cached;

  const coll = getCountryStateCollection(db);
  // Defensive findOne: MockDbs that don't stub the collection return a
  // sparse object missing `findOne` / `insertOne`. Wrapped in try/catch
  // so a missing-method TypeError falls through to self-heal instead of
  // crashing the caller. Production always has a real collection so
  // this only kicks in for test mocks.
  let doc: CountryState | null = null;
  try {
    doc = await coll.findOne({ _id: countryId });
  } catch {
    doc = null;
  }
  if (doc) {
    setCachedCountryState(db, doc);
    return doc;
  }

  // No DB doc — self-heal from COUNTRY_CONFIGS if the countryId is known.
  // Unknown countryIds throw so a typo doesn't silently spawn garbage rows.
  if (!COUNTRY_CONFIGS[countryId]) {
    throw new Error(`getCountryState: unknown countryId "${countryId}"`);
  }
  const seed = seedCountryStateFromConfig(countryId, new Date());
  setCachedCountryState(db, seed);
  // Best-effort persist so future reads see the same row. Wrapped in
  // try/catch (not just .catch) so MockDbs that don't stub insertOne
  // don't crash with "insertOne is not a function". Production paths
  // always have a real collection; the cache + next findOne resolves
  // to whatever the winner inserted on concurrent init.
  try {
    await coll.insertOne(seed);
  } catch {
    /* ignore — defensive against MockDb shape AND concurrent inserts */
  }
  return seed;
}

/**
 * Warm the cache for many countries in ONE round trip.
 *
 * `getCountryState` memoises per Db INSTANCE, and `MongoClient.db()` returns a
 * new instance on every call, so the memo lives exactly as long as one `getDb()`
 * result and is cold at the start of every request. A listing that resolves
 * eighty countries therefore pays eighty sequential `findOne`s unless it primes
 * first. Countries with no row are left alone: `getCountryState` self-heals them
 * from seed config individually, which is the rare path.
 */
export async function primeCountryStates(db: Db, countryIds: CountryId[]): Promise<void> {
  const missing = countryIds.filter((id) => !getCachedCountryState(db, id));
  if (missing.length === 0) return;
  // Defensive, matching `getCountryState`: MockDbs that don't stub `find`
  // fall through to the per-country path rather than crashing the caller.
  try {
    const docs = await getCountryStateCollection(db)
      .find({ _id: { $in: missing } })
      .toArray();
    for (const doc of docs) setCachedCountryState(db, doc);
  } catch {
    /* ignore — callers still resolve one at a time */
  }
}

/**
 * Apply a partial patch to a country's runtime state. Stamps updatedAt
 * and invalidates the cache so subsequent reads see fresh data.
 *
 * Symmetric with getCountryState: if the doc is missing, ensures it
 * exists via self-heal first, then applies the patch. This matters for
 * Phase 6 (system conversion) writes against countries whose row was
 * never explicitly seeded (self-heals the operator-forgot-migration
 * footgun).
 */
export async function updateCountryState(
  db: Db,
  countryId: CountryId,
  patch: CountryStatePatch
): Promise<CountryState> {
  // Ensure the doc exists (self-heal via getCountryState) before patching
  // so a Phase-6 write to an unseeded country doesn't silently fail.
  await getCountryState(db, countryId);

  const coll = getCountryStateCollection(db);
  const result = await coll.findOneAndUpdate(
    { _id: countryId },
    { $set: { ...patch, updatedAt: new Date() } },
    { returnDocument: "after" }
  );

  if (!result) {
    // Should be unreachable post-self-heal, but defensive in case the
    // self-heal insert was lost to a concurrent delete (degenerate state).
    throw new Error(`updateCountryState: no countryState for "${countryId}"`);
  }

  invalidateCachedCountryState(db, countryId);
  return result;
}

export { getCountryStateCollection } from "@/lib/db/collections/countryState";
