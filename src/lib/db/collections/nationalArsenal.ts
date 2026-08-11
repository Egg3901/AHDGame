import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { UnitDomain } from "@/lib/db/types/militaryUnit";
import { type NationalArsenal, EMPTY_ARSENAL_STOCK } from "@/lib/db/types/nationalArsenal";
import { blendGrade } from "@/lib/military/arsenal";

function arsenals(db: Db) {
  return db.collection<NationalArsenal>("nationalArsenal");
}

function emptyArsenal(countryId: string): NationalArsenal {
  return {
    countryId: countryId as CountryId,
    stock: { ...EMPTY_ARSENAL_STOCK },
    grade: { ...EMPTY_ARSENAL_STOCK },
  };
}

/**
 * A country's arsenal, or an empty one.
 *
 * Unlike the defence appropriation, this does NOT heal a document into existence: an empty
 * arsenal is the correct and expected starting state for every nation — they all begin with
 * nothing in store and build up — so there is nothing to distinguish "missing" from "empty"
 * and no reason to write on a read.
 */
export async function getNationalArsenal(db: Db, countryId: string): Promise<NationalArsenal> {
  const doc = await arsenals(db).findOne({ countryId: countryId as CountryId });
  if (!doc) return emptyArsenal(countryId);
  // Back-fill any domain missing from a document written before a domain existed, so callers
  // can index all six without undefined leaking into arithmetic.
  return {
    ...doc,
    stock: { ...EMPTY_ARSENAL_STOCK, ...doc.stock },
    grade: { ...EMPTY_ARSENAL_STOCK, ...doc.grade },
  };
}

/**
 * Add delivered lots to a domain's store and re-blend its grade.
 *
 * Grade is computed from the CURRENT document rather than incremented, so it must be read
 * and written together — hence an upsert with `$set` on that one field rather than a bare
 * `$inc`. The stock half is still an `$inc` so two deliveries in the same turn cannot lose
 * each other.
 */
export async function depositLots(
  db: Db,
  countryId: string,
  domain: UnitDomain,
  lots: number,
  grade: number
): Promise<void> {
  const amount = Math.max(0, Math.round(lots));
  if (amount <= 0) return;

  const current = await getNationalArsenal(db, countryId);
  const blended = blendGrade(current.stock[domain], current.grade[domain], amount, grade);

  await arsenals(db).updateOne(
    { countryId: countryId as CountryId },
    {
      $inc: { [`stock.${domain}`]: amount },
      $set: { [`grade.${domain}`]: blended, updatedAt: new Date() },
      $setOnInsert: {
        countryId: countryId as CountryId,
      },
    },
    { upsert: true }
  );
}

/**
 * Take up to `lots` from a domain's store, returning how many were actually taken.
 *
 * Partial draws are the norm, not an error: an arsenal that cannot fill an order still
 * issues what it has, and the caller equips the unit at the resulting fill. Callers MUST use
 * the returned figure rather than what they asked for — that is the number that left the
 * store.
 *
 * Drains atomically against the live stock so two concurrent draws cannot both take the same
 * lots. Grade is deliberately untouched: issuing kit does not make the remaining kit worse.
 */
export async function drawLots(
  db: Db,
  countryId: string,
  domain: UnitDomain,
  lots: number
): Promise<number> {
  const wanted = Math.max(0, Math.round(lots));
  if (wanted <= 0) return 0;

  // Try the full amount first; on failure fall back to whatever the store currently holds.
  // Both attempts are guarded, so a concurrent draw makes this return less rather than
  // driving the stock negative.
  const full = await arsenals(db).updateOne(
    { countryId: countryId as CountryId, [`stock.${domain}`]: { $gte: wanted } },
    { $inc: { [`stock.${domain}`]: -wanted }, $set: { updatedAt: new Date() } }
  );
  if (full.modifiedCount > 0) return wanted;

  const current = await getNationalArsenal(db, countryId);
  const available = Math.max(0, Math.floor(current.stock[domain]));
  if (available <= 0) return 0;

  const partial = await arsenals(db).updateOne(
    { countryId: countryId as CountryId, [`stock.${domain}`]: { $gte: available } },
    { $inc: { [`stock.${domain}`]: -available }, $set: { updatedAt: new Date() } }
  );
  return partial.modifiedCount > 0 ? available : 0;
}

/** Return lots to the store — the rollback path when an order fails after drawing. */
export async function returnLots(
  db: Db,
  countryId: string,
  domain: UnitDomain,
  lots: number
): Promise<void> {
  const amount = Math.max(0, Math.round(lots));
  if (amount <= 0) return;
  await arsenals(db).updateOne(
    { countryId: countryId as CountryId },
    { $inc: { [`stock.${domain}`]: amount }, $set: { updatedAt: new Date() } },
    { upsert: true }
  );
}
