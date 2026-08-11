import type { Db } from "mongodb";
import type { NationalDoctrine } from "@/lib/db/types/nationalDoctrine";
import type { CountryId } from "@/lib/constants/countries";
import { DEFAULT_ADOPTED, DEFAULT_POINTS } from "@/lib/military/doctrineTree";

export function getNationalDoctrineCollection(db: Db) {
  return db.collection<NationalDoctrine>("nationalDoctrine");
}

/**
 * The stored doctrine for a country, or the design defaults when none exists.
 * The default is never persisted on read — the doc is created on first adopt.
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
