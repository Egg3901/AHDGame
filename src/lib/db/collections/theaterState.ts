import type { Db } from "mongodb";
import type { TheaterStateDoc } from "@/lib/db/types/theaterState";
import type { CountryId } from "@/lib/constants/countries";

export function getTheaterStateCollection(db: Db) {
  return db.collection<TheaterStateDoc>("theaterState");
}

/**
 * The stored situation state for a country, or defaults when none exists.
 * The default is never persisted on read — the doc is created on first save.
 */
export async function getTheaterState(
  db: Db,
  countryId: string
): Promise<{ cohesion: number; committed: Record<string, number> }> {
  const doc = await getTheaterStateCollection(db).findOne({
    countryId: countryId as CountryId,
  });
  if (!doc) return { cohesion: 85, committed: {} };
  return { cohesion: doc.cohesion, committed: doc.committed };
}

/** Every country's situation state (all committed forces) — for region-threat. */
export async function listTheaterStates(db: Db): Promise<TheaterStateDoc[]> {
  return getTheaterStateCollection(db).find({}).toArray();
}
