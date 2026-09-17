import type { Db, ObjectId } from "mongodb";
import type { Character, Corporation } from "@/lib/db/types";
import { getControllingCorporateParent } from "@/lib/corporations/corporateOwnership";
import {
  isFormalizedSubsidiary,
  subsidiaryCeoBlockReason,
  type SubsidiaryCeoBlockReason,
} from "./helpers";

const SYSTEM_USER_ID = "000000000000000000000000";

/**
 * The `userId` of the human behind the parent's CEO seat. For a caretaker-run
 * parent the human is stashed in `caretakerCeo.underlyingUserId`; otherwise it
 * is the parent's `userId`. Falls back to `userId` when the CEO character has no
 * resolvable owner.
 */
export async function resolveParentCeoUserId(
  db: Db,
  parent: Pick<Corporation, "userId" | "ceoId" | "ceoType" | "caretakerCeo">
): Promise<ObjectId> {
  if (parent.caretakerCeo?.underlyingUserId) return parent.caretakerCeo.underlyingUserId;
  if (parent.ceoType === "character" && parent.ceoId) {
    const ceo = await db
      .collection<Character>("characters")
      .findOne({ _id: parent.ceoId }, { projection: { userId: 1 } });
    if (ceo?.userId) return ceo.userId;
  }
  return parent.userId;
}

/**
 * User ids of the humans currently sitting as CEO of every OTHER formalized
 * subsidiary controlled (>50% voting) by `parentId`. NPP-run subsidiaries,
 * including NPP caretakers, are skipped: the computer is the operator. The
 * displaced human stays in `caretakerCeo` for reclaim, which is gated separately.
 */
export async function collectSiblingSubsidiaryCeoUserIds(
  db: Db,
  parentId: ObjectId,
  excludeSubId: ObjectId
): Promise<ObjectId[]> {
  const formalized = await db
    .collection<Corporation>("corporations")
    .find(
      { subsidiaryFormalizedAtTurn: { $exists: true } },
      {
        projection: {
          _id: 1,
          shareholders: 1,
          totalShares: 1,
          superShareMultiplier: 1,
          userId: 1,
          ceoType: 1,
          ceoVacant: 1,
        },
      }
    )
    .toArray();

  const out: ObjectId[] = [];
  for (const corp of formalized) {
    if (corp._id.equals(excludeSubId)) continue;
    const controller = getControllingCorporateParent(corp);
    if (!controller || !controller.corporationId.equals(parentId)) continue;
    if (corp.ceoType === "npp") continue;
    if (corp.ceoVacant === true) continue;
    const humanUserId = corp.userId;
    if (!humanUserId) continue;
    if (humanUserId.toString() === SYSTEM_USER_ID) continue;
    out.push(humanUserId);
  }
  return out;
}

/**
 * Whether restoring `candidateUserId` as the sitting CEO of `corp` would break
 * the subsidiary one-person rule. Null when the corp is not a managed
 * subsidiary or the candidate is allowed.
 */
export async function subsidiaryReclaimBlocked(
  db: Db,
  corp: Corporation,
  candidateUserId: ObjectId
): Promise<SubsidiaryCeoBlockReason | null> {
  const controllingParent = getControllingCorporateParent(corp);
  if (!isFormalizedSubsidiary(corp, controllingParent)) return null;
  if (!controllingParent) return null;

  const parent = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: controllingParent.corporationId });
  if (!parent?.userId) return null;

  const parentCeoUserId = await resolveParentCeoUserId(db, parent);
  const siblingCeoUserIds = await collectSiblingSubsidiaryCeoUserIds(db, parent._id, corp._id);
  return subsidiaryCeoBlockReason({
    candidateUserId,
    parentOwnerUserId: parent.userId,
    parentCeoUserId,
    siblingSubsidiaryCeoUserIds: siblingCeoUserIds,
  });
}
