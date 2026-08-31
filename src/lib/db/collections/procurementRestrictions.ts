import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/**
 * A country barred from creating NEW defence procurement obligations by the terms
 * of a peace settlement.
 *
 * One row per country: a second restriction extends the one in force rather than
 * stacking, which is why the country id is the primary key.
 */
export interface ProcurementRestrictionDoc {
  /** `countryId`. One row per country. */
  _id: CountryId;
  countryId: CountryId;
  /** Lapses ON this turn, the same boundary convention as a truce and an offer. */
  expiresTurn: number;
  /** The war it came out of, so a surface can explain where the bar came from. */
  conflictId: string;
}

const COLLECTION = "procurementRestrictions";

export function getProcurementRestrictionsCollection(db: Db) {
  return db.collection<ProcurementRestrictionDoc>(COLLECTION);
}

/**
 * Start or extend a country's procurement bar.
 *
 * `$max` on `expiresTurn` rather than `$set`, for exactly the reason `recordTruce`
 * uses it: two settlements landing out of order must not let an earlier expiry
 * shorten a bar already in force. `$max` makes the order of the writes stop
 * mattering.
 */
export async function recordProcurementRestriction(
  db: Db,
  countryId: CountryId,
  expiresTurn: number,
  conflictId: string
): Promise<void> {
  await getProcurementRestrictionsCollection(db).updateOne(
    { _id: countryId },
    {
      $max: { expiresTurn },
      $setOnInsert: { countryId, conflictId },
    },
    { upsert: true }
  );
}

/**
 * The turn a live bar on this country lapses, or null when none is in force.
 *
 * Lapses ON the expiry turn, not after it, matching `isOfferLive` and
 * `activeTruceExpiry` so "240 turns" means the same thing everywhere.
 */
export async function activeProcurementRestriction(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<number | null> {
  const doc = await getProcurementRestrictionsCollection(db).findOne({ _id: countryId });
  if (!doc) return null;
  return currentTurn < doc.expiresTurn ? doc.expiresTurn : null;
}
