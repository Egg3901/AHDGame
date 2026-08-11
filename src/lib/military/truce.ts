import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { TRUCE_TURNS } from "@/lib/db/types/peaceOffer";

export interface TruceDoc {
  /** `trucePairId` — the two country ids sorted and joined. */
  _id: string;
  countries: [CountryId, CountryId];
  expiresTurn: number;
}

const COLLECTION = "truces";

export function getTrucesCollection(db: Db) {
  return db.collection<TruceDoc>(COLLECTION);
}

/**
 * Deterministic key for an UNORDERED pair.
 *
 * Sorted so `(UK, CN)` and `(CN, UK)` are the same document: a pair cannot
 * accumulate rows, and a lookup needs no `$or` over both orderings.
 */
export function trucePairId(a: CountryId, b: CountryId): string {
  return [a, b].sort().join("__");
}

/**
 * Start (or extend) a truce between two countries.
 *
 * `$max` rather than `$set`: a war ending records a truce for every cross-side pair,
 * and those pairs can overlap with a truce already running from an earlier deal. With
 * `$set`, whichever call happened to land last would win — including one carrying an
 * EARLIER expiry, which would silently shorten a truce that was already in force.
 * `$max` makes the order of the writes stop mattering.
 */
export async function recordTruce(
  db: Db,
  a: CountryId,
  b: CountryId,
  currentTurn: number
): Promise<void> {
  const _id = trucePairId(a, b);
  await getTrucesCollection(db).updateOne(
    { _id },
    {
      $max: { expiresTurn: currentTurn + TRUCE_TURNS },
      $setOnInsert: { countries: [a, b].sort() as [CountryId, CountryId] },
    },
    { upsert: true }
  );
}

/**
 * The turn a live truce between these two lapses, or null if none is in force.
 *
 * Lapses ON the expiry turn, not after it — the same boundary convention as
 * `isOfferLive`, so "240 turns" means the same thing in both places.
 */
export async function activeTruceExpiry(
  db: Db,
  a: CountryId,
  b: CountryId,
  currentTurn: number
): Promise<number | null> {
  const doc = await getTrucesCollection(db).findOne({ _id: trucePairId(a, b) });
  if (!doc) return null;
  return currentTurn < doc.expiresTurn ? doc.expiresTurn : null;
}

/**
 * Every live truce this country is bound by, as `{ other, expiresTurn }`.
 *
 * Lets a surface state the bar BEFORE a player acts, rather than leaving it to be
 * discovered by a refusal. The pair key is sorted, so the country may sit on either
 * end of `countries` and the caller is told which one is the other party.
 */
export async function listActiveTruces(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<Array<{ other: CountryId; expiresTurn: number }>> {
  const rows = await getTrucesCollection(db)
    .find({ countries: countryId, expiresTurn: { $gt: currentTurn } })
    .toArray();
  return rows.map((r) => ({
    other: r.countries[0] === countryId ? r.countries[1] : r.countries[0],
    expiresTurn: r.expiresTurn,
  }));
}
