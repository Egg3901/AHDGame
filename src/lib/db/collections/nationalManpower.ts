import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NationalManpower } from "@/lib/db/types/nationalManpower";

export function getNationalManpowerCollection(db: Db) {
  return db.collection<NationalManpower>("nationalManpower");
}

/** A nation's pool, or the defaults when none is stored. Never persisted on read. */
export async function getNationalManpower(
  db: Db,
  countryId: string,
  session?: ClientSession
): Promise<Pick<NationalManpower, "pool" | "mode">> {
  const doc = await getNationalManpowerCollection(db).findOne(
    { countryId: countryId as CountryId },
    session ? { session } : undefined
  );
  if (!doc) return { pool: 0, mode: "trained" };
  return { pool: doc.pool, mode: doc.mode };
}

export async function setNationalManpower(
  db: Db,
  countryId: string,
  patch: Partial<Pick<NationalManpower, "pool" | "mode">>,
  session?: ClientSession
): Promise<void> {
  await getNationalManpowerCollection(db).updateOne(
    { countryId: countryId as CountryId },
    { $set: patch },
    { upsert: true, ...(session ? { session } : {}) }
  );
}
