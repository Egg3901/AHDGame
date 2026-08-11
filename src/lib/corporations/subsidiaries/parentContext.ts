import type { Db, ObjectId } from "mongodb";
import type { Character, Corporation } from "@/lib/db/types";
import { getControllingCorporateParent } from "@/lib/corporations/corporateOwnership";

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
 * User ids of the humans operating every OTHER formalized subsidiary controlled
 * (>50% voting) by `parentId`. Used to enforce the one-person rule across
 * sibling subsidiaries. NPP-run subsidiaries (system-placeholder `userId`) are
 * skipped since no human operates them.
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
          caretakerCeo: 1,
        },
      }
    )
    .toArray();

  const out: ObjectId[] = [];
  for (const corp of formalized) {
    if (corp._id.equals(excludeSubId)) continue;
    const controller = getControllingCorporateParent(corp);
    if (!controller || !controller.corporationId.equals(parentId)) continue;
    // A caretaker-run subsidiary keeps a human behind the seat (the appointer).
    const humanUserId = corp.caretakerCeo?.underlyingUserId ?? corp.userId;
    if (!humanUserId) continue;
    if (humanUserId.toString() === SYSTEM_USER_ID) continue;
    if (corp.ceoType === "npp" && !corp.caretakerCeo) continue;
    out.push(humanUserId);
  }
  return out;
}
