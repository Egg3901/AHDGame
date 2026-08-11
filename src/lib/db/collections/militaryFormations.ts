import type { Db } from "mongodb";
import type { MilitaryFormationsDoc } from "@/lib/db/types/militaryFormations";
import type { ConflictAssignment } from "@/lib/military/assignments";
import type { CountryId } from "@/lib/constants/countries";

export function getMilitaryFormationsCollection(db: Db) {
  return db.collection<MilitaryFormationsDoc>("militaryFormations");
}

/**
 * The stored military org layer for a country, or empty defaults when none exists.
 * The default is never persisted on read — the doc is created on first save.
 *
 * `conflictAssignments` is defaulted for docs written before it existed (and for
 * docs that still carry the retired `formations` array), so callers never have to
 * null-check it.
 */
export async function getMilitaryFormations(
  db: Db,
  countryId: string
): Promise<{ conflictAssignments: ConflictAssignment[]; positions: Record<string, string> }> {
  const doc = await getMilitaryFormationsCollection(db).findOne({
    countryId: countryId as CountryId,
  });
  if (!doc) return { conflictAssignments: [], positions: {} };
  return {
    conflictAssignments: doc.conflictAssignments ?? [],
    positions: doc.positions ?? {},
  };
}
