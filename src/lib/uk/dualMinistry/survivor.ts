import type { Db, ObjectId } from "mongodb";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { CABINET_OFFICE_TYPES } from "@/lib/actions/officeActionBonus";
import type { Character, OfficeType } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Preserve the surviving cabinet row after one seat is vacated (issue #2049).
 *
 * When a dual-office UK holder loses one seat (fired, resigned, or removed),
 * the other row survives: repoint `currentOffice` at it instead of restoring
 * the legislative seat. Returns true when a surviving row exists (the caller
 * must then skip its legacy office restore). Returns false when no row
 * remains, in which case the caller runs its normal restore. Never touches a
 * `currentOffice` that already moved on from cabinet.
 */
export async function preserveSurvivingCabinetRow(
  db: Db,
  countryId: CountryId,
  characterId: ObjectId,
  now: Date
): Promise<boolean> {
  const survivors = await getCabinetMembersCollection(db)
    .find({ countryId, characterId })
    .project({ positionId: 1, roleSlot: 1 })
    .toArray();
  if (survivors.length === 0) return false;
  const survivor = survivors.find((row) => row.roleSlot === "departmental") ?? survivors[0]!;
  const character = await db
    .collection<Character>("characters")
    .findOne({ _id: characterId }, { projection: { currentOffice: 1 } });
  const current = character?.currentOffice;
  if (!current || !CABINET_OFFICE_TYPES.has(current.type)) return true;
  if (!("positionId" in current)) return true;
  if (current.positionId === survivor.positionId) return true;
  const survivorOffice: OfficeType = { ...current, positionId: survivor.positionId };
  await db
    .collection<Character>("characters")
    .updateOne({ _id: characterId }, { $set: { currentOffice: survivorOffice, updatedAt: now } });
  return true;
}
