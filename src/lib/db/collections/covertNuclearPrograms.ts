import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CovertNuclearProgram } from "@/lib/db/types/covertNuclearProgram";
import { emptyCovertProgram } from "@/lib/military/covertNuclear";

export const COVERT_NUCLEAR_PROGRAMS_COLLECTION = "covertNuclearPrograms";

export function getCovertNuclearProgramsCollection(db: Db) {
  return db.collection<CovertNuclearProgram>(COVERT_NUCLEAR_PROGRAMS_COLLECTION);
}

/** The empty programme; never persisted on read (nuclearPrograms pattern). */
export function emptyCovertNuclearProgram(countryId: CountryId): CovertNuclearProgram {
  return {
    _id: countryId,
    ...emptyCovertProgram(),
    updatedAt: new Date(0),
  };
}

export async function getCovertNuclearProgram(
  db: Db,
  countryId: CountryId
): Promise<CovertNuclearProgram> {
  const doc = await getCovertNuclearProgramsCollection(db).findOne({ _id: countryId });
  if (!doc) return emptyCovertNuclearProgram(countryId);
  const empty = emptyCovertNuclearProgram(countryId);
  return {
    _id: countryId,
    stage: doc.stage ?? empty.stage,
    progress: doc.progress ?? empty.progress,
    funding: doc.funding ?? empty.funding,
    suspicion: doc.suspicion ?? empty.suspicion,
    exposureCount: doc.exposureCount ?? empty.exposureCount,
    completed: doc.completed ?? empty.completed,
    startedTurn: doc.startedTurn,
    brokenOutTurn: doc.brokenOutTurn,
    updatedAt: doc.updatedAt ?? empty.updatedAt,
  };
}

export async function putCovertNuclearProgram(
  db: Db,
  program: CovertNuclearProgram
): Promise<void> {
  const { _id, ...rest } = program;
  await getCovertNuclearProgramsCollection(db).updateOne(
    { _id },
    { $set: { ...rest, updatedAt: new Date() } },
    { upsert: true }
  );
}
