import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { getControllingCorporateParent } from "@/lib/corporations/corporateOwnership";
import { isSubsidiaryCorporationsEnabled } from "./featureFlag";

/**
 * True iff `callerUserId` is the sitting CEO (owner) of the corporation that
 * currently controls `sub` (>50% voting power), AND `sub` is formalized as a
 * managed subsidiary, AND the feature flag is on.
 *
 * Parent authority is DERIVED here on every call: the controlling parent is
 * recomputed from `sub.shareholders`, so if the parent's voting stake slips
 * below 50% the powers silently lapse — no stale pointer can exist. `userId` is
 * never used to carry parent authority.
 */
export async function canActOnCorporationAsParent(
  db: Db,
  callerUserId: ObjectId,
  sub: Corporation
): Promise<boolean> {
  if (!(await isSubsidiaryCorporationsEnabled())) return false;
  if (sub.subsidiaryFormalizedAtTurn == null) return false;
  if (sub.countryOwnerId) return false;

  const controllingParent = getControllingCorporateParent(sub);
  if (!controllingParent) return false;

  const parent = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: controllingParent.corporationId }, { projection: { userId: 1, ceoVacant: 1 } });
  if (!parent) return false;
  if (parent.ceoVacant === true) return false;
  if (!parent.userId) return false;
  return parent.userId.equals(callerUserId);
}
