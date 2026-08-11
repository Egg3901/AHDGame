import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { MAX_DIVIDEND_RATE } from "@/lib/constants/corporations";
import { getControllingCorporateParent } from "@/lib/corporations/corporateOwnership";
import { canActOnCorporationAsParent } from "../authorization";
import { fail, type SubsidiaryCommandResult } from "../commandTypes";

export interface SetParentDividendFloorInput {
  sub: Corporation;
  callerUserId: ObjectId;
  floorPct: number;
  now: Date;
}

/**
 * Parent sets a dividend floor on the subsidiary. Stored as
 * `parentDividendFloorPct` + `parentDividendFloorSetByCorpId` and folded into
 * the existing effective-dividend-rate `max(...)` at turn + detail sites — only
 * honored while the setter still controls >50% voting of this corp.
 */
export async function setParentDividendFloor(
  db: Db,
  input: SetParentDividendFloorInput
): Promise<SubsidiaryCommandResult<{ parentDividendFloorPct: number }>> {
  const { sub, callerUserId, floorPct, now } = input;

  if (!(await canActOnCorporationAsParent(db, callerUserId, sub))) {
    return fail("You are not authorized to manage this subsidiary.", 403);
  }

  const controllingParent = getControllingCorporateParent(sub);
  if (!controllingParent) return fail("This corporation is no longer a subsidiary.", 409);

  if (!Number.isFinite(floorPct)) return fail("Invalid dividend floor.");
  const clamped = Math.max(0, Math.min(MAX_DIVIDEND_RATE, Math.round(floorPct)));

  await db.collection<Corporation>("corporations").updateOne(
    { _id: sub._id },
    {
      $set: {
        parentDividendFloorPct: clamped,
        parentDividendFloorSetByCorpId: controllingParent.corporationId,
        updatedAt: now,
      },
    }
  );

  return { ok: true, parentDividendFloorPct: clamped };
}
