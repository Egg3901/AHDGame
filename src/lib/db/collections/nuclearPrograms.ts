import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NuclearProgram } from "@/lib/db/types/nuclearProgram";

export const NUCLEAR_PROGRAMS_COLLECTION = "nuclearPrograms";

export function getNuclearProgramsCollection(db: Db) {
  return db.collection<NuclearProgram>(NUCLEAR_PROGRAMS_COLLECTION);
}

/** The empty programme; never persisted on read (nationalDoctrine pattern). */
export function emptyNuclearProgram(countryId: CountryId): NuclearProgram {
  return {
    _id: countryId,
    adopted: {},
    warheads: 0,
    productionRate: 0,
    updatedAt: new Date(0),
  };
}

export async function getNuclearProgram(db: Db, countryId: CountryId): Promise<NuclearProgram> {
  const doc = await getNuclearProgramsCollection(db).findOne({ _id: countryId });
  if (!doc) return emptyNuclearProgram(countryId);
  const empty = emptyNuclearProgram(countryId);
  return {
    _id: countryId,
    adopted: doc.adopted ?? empty.adopted,
    warheads: doc.warheads ?? 0,
    productionRate: doc.productionRate ?? 0,
    lastTestTurn: doc.lastTestTurn,
    updatedAt: doc.updatedAt ?? empty.updatedAt,
  };
}

/** All programmes that exist (countries that never opened one are absent). */
export async function listNuclearPrograms(db: Db): Promise<NuclearProgram[]> {
  return getNuclearProgramsCollection(db).find({}).toArray();
}

export async function putNuclearProgram(db: Db, program: NuclearProgram): Promise<void> {
  const { _id, ...rest } = program;
  await getNuclearProgramsCollection(db).updateOne(
    { _id },
    { $set: { ...rest, updatedAt: new Date() } },
    { upsert: true }
  );
}
