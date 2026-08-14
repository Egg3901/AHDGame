import type { Db } from "mongodb";
import type { NationalDoctrine } from "@/lib/db/types/nationalDoctrine";
import type { CountryId } from "@/lib/constants/countries";
import { DEFAULT_ADOPTED, DEFAULT_POINTS } from "@/lib/military/doctrineTree";
import { doctrineIncomeDue } from "@/lib/military/doctrineIncome";

export function getNationalDoctrineCollection(db: Db) {
  return db.collection<NationalDoctrine>("nationalDoctrine");
}

/**
 * The stored doctrine for a country, or the design defaults when none exists.
 * The default is never persisted on read — the doc is created on first adopt
 * or the first income grant, whichever lands first.
 */
export async function getNationalDoctrine(
  db: Db,
  countryId: string
): Promise<{ adopted: Record<string, number>; points: number }> {
  const doc = await getNationalDoctrineCollection(db).findOne({
    countryId: countryId as CountryId,
  });
  if (!doc) return { adopted: { ...DEFAULT_ADOPTED }, points: DEFAULT_POINTS };
  return { adopted: doc.adopted, points: doc.points };
}

/**
 * Book any yearly doctrine-point income not yet granted through `currentYear`.
 *
 * Race-safe: the `$inc` is filtered on the through-year we just read, so two
 * concurrent grants for the same year cannot both land. Returns the post-grant
 * remaining points (and adopted set) so callers do not need a second read.
 *
 * Unusable years are a no-op so a turn without a resolved calendar cannot mint
 * points from a missing clock.
 */
export async function settleDoctrineIncome(
  db: Db,
  countryId: string,
  startingYear: number,
  currentYear: number
): Promise<{ adopted: Record<string, number>; points: number }> {
  const col = getNationalDoctrineCollection(db);
  const id = countryId as CountryId;
  const doc = await col.findOne({ countryId: id });
  const grant = doctrineIncomeDue(startingYear, currentYear, doc?.incomeThroughYear);
  if (grant <= 0) {
    if (!doc) return { adopted: { ...DEFAULT_ADOPTED }, points: DEFAULT_POINTS };
    return { adopted: doc.adopted, points: doc.points };
  }

  if (!doc) {
    const points = DEFAULT_POINTS + grant;
    await col.insertOne({
      countryId: id,
      adopted: { ...DEFAULT_ADOPTED },
      points,
      incomeThroughYear: currentYear,
    });
    return { adopted: { ...DEFAULT_ADOPTED }, points };
  }

  const throughFilter =
    doc.incomeThroughYear == null
      ? { incomeThroughYear: { $exists: false } }
      : { incomeThroughYear: doc.incomeThroughYear };
  const res = await col.updateOne(
    { countryId: id, ...throughFilter },
    { $inc: { points: grant }, $set: { incomeThroughYear: currentYear } }
  );
  // A concurrent settler won the race — re-read rather than inventing a total.
  if (res.modifiedCount === 0) {
    const fresh = await col.findOne({ countryId: id });
    if (!fresh) return { adopted: { ...DEFAULT_ADOPTED }, points: DEFAULT_POINTS };
    return { adopted: fresh.adopted, points: fresh.points };
  }
  return { adopted: doc.adopted, points: doc.points + grant };
}
