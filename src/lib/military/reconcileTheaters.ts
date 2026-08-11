import type { Db, ObjectId } from "mongodb";
import type { MilitaryUnit, Posture } from "@/lib/db/types/militaryUnit";
import type { CountryId } from "@/lib/constants/countries";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { type ConflictAssignment, theaterOfUnit } from "./assignments";
import { postureFloorFor } from "./theaters";

/**
 * Pure: units whose derived theater and/or floored posture differ from stored, with
 * the values they should move to. A unit follows its assigned general's posting
 * (theaterOfUnit); deploying to a Conflict also floors Garrison → Standard
 * (postureFloorFor). Anything already correct is omitted so we never write a no-op;
 * `posture` is only present in an item when it actually changed.
 */
export function planReconciliation(
  units: Pick<MilitaryUnit, "_id" | "theaterId" | "assignedGeneralId" | "posture">[],
  assignments: ConflictAssignment[]
): { _id: ObjectId; theaterId: string; posture?: Posture }[] {
  const plan: { _id: ObjectId; theaterId: string; posture?: Posture }[] = [];
  for (const u of units) {
    const theaterId = theaterOfUnit(u.assignedGeneralId, assignments);
    const posture = postureFloorFor(theaterId, u.posture);
    if (theaterId !== u.theaterId || posture !== u.posture) {
      plan.push({ _id: u._id, theaterId, ...(posture !== u.posture && { posture }) });
    }
  }
  return plan;
}

/**
 * Reconcile every unit's stored `theaterId` to its assigned general's posting.
 * Call after any write that changes the unit→general or general→theater mapping
 * (unit assignment, general re-posting, dismissal). Keeps `theaterId` an authoritative
 * cache so battle math can keep filtering on it directly.
 */
export async function reconcileUnitTheaters(
  db: Db,
  countryId: CountryId,
  assignments: ConflictAssignment[]
): Promise<void> {
  const col = getMilitaryUnitsCollection(db);
  const units = (await col
    .find({ countryId })
    .project({ _id: 1, theaterId: 1, assignedGeneralId: 1, posture: 1 })
    .toArray()) as Pick<MilitaryUnit, "_id" | "theaterId" | "assignedGeneralId" | "posture">[];
  const plan = planReconciliation(units, assignments);
  if (plan.length === 0) return;
  await col.bulkWrite(
    plan.map((p) => ({
      updateOne: {
        filter: { _id: p._id },
        update: { $set: { theaterId: p.theaterId, ...(p.posture && { posture: p.posture }) } },
      },
    }))
  );
}
