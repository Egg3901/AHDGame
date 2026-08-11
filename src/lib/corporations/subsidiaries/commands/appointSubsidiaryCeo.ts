import type { Db, ObjectId } from "mongodb";
import type { Character, Corporation } from "@/lib/db/types";
import { getControllingCorporateParent } from "@/lib/corporations/corporateOwnership";
import { appointCaretakerCeo } from "@/lib/corporations/caretakerCeo";
import { openCeoTenure, closeCeoTenure } from "@/lib/corporations/ceoHistory";
import { canActOnCorporationAsParent } from "../authorization";
import { humanBlockedFromSubsidiaryCeo } from "../helpers";
import { collectSiblingSubsidiaryCeoUserIds, resolveParentCeoUserId } from "../parentContext";
import { fail, type SubsidiaryCommandResult } from "../commandTypes";

export interface AppointSubsidiaryCeoInput {
  sub: Corporation;
  callerUserId: ObjectId;
  ceoType: "character" | "npp";
  characterId?: ObjectId;
  forcedNppId?: string;
  turn: number;
  now: Date;
}

/**
 * Parent CEO reseats the subsidiary's CEO. NPP path reuses the existing
 * caretaker mechanism (leaves `userId` intact, sets `caretakerCeo`). Character
 * path enforces the one-person rule and updates `userId`/`ceoId`/`ceoType`.
 */
export async function appointSubsidiaryCeo(
  db: Db,
  input: AppointSubsidiaryCeoInput
): Promise<SubsidiaryCommandResult<{ ceoType: "character" | "npp"; nppName?: string }>> {
  const { sub, callerUserId, ceoType, characterId, forcedNppId, turn, now } = input;

  if (!(await canActOnCorporationAsParent(db, callerUserId, sub))) {
    return fail("You are not authorized to manage this subsidiary.", 403);
  }

  const controllingParent = getControllingCorporateParent(sub);
  if (!controllingParent) return fail("This corporation is no longer a subsidiary.", 409);
  const parent = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: controllingParent.corporationId });
  if (!parent) return fail("Parent corporation not found.", 404);

  if (ceoType === "npp") {
    const appoint = await appointCaretakerCeo(db, { corp: sub, forcedNppId, turn, now });
    if (!appoint.ok) {
      const msg =
        appoint.error === "already-caretaker"
          ? "This subsidiary is already run by an NPP caretaker."
          : appoint.error === "ceo-not-character"
            ? "The subsidiary must currently have a human CEO before an NPP caretaker can be installed."
            : appoint.error === "no-eligible-npp" || appoint.error === "npp-not-eligible"
              ? "No eligible NPP is available to caretake this subsidiary."
              : "Could not install an NPP caretaker.";
      return fail(msg);
    }
    return { ok: true, ceoType: "npp", nppName: appoint.nppName };
  }

  // Character path.
  if (!characterId) return fail("A character is required to appoint a human CEO.");
  const character = await db
    .collection<Character>("characters")
    .findOne({ _id: characterId }, { projection: { userId: 1 } });
  if (!character || !character.userId) {
    return fail("The selected character cannot serve as CEO (no owning player).");
  }

  // One-person rule keys on the human behind the CEO seat.
  const parentOwnerUserId = parent.userId;
  const parentCeoUserId = await resolveParentCeoUserId(db, parent);
  const siblingCeoUserIds = await collectSiblingSubsidiaryCeoUserIds(db, parent._id, sub._id);
  if (
    humanBlockedFromSubsidiaryCeo({
      candidateUserId: character.userId,
      parentOwnerUserId,
      parentCeoUserId,
      siblingSubsidiaryCeoUserIds: siblingCeoUserIds,
    })
  ) {
    return fail("A subsidiary must be run by a different player than the parent.", 403);
  }

  // Reseat: close the current holder's tenure, then set the new human CEO.
  const previousCeoId = sub.ceoId;
  await db.collection<Corporation>("corporations").updateOne(
    { _id: sub._id },
    {
      $set: {
        ceoId: characterId,
        ceoType: "character",
        userId: character.userId,
        ceoVacant: false,
        updatedAt: now,
      },
      $unset: { caretakerCeo: "", pendingCeoCharacterId: "" },
    }
  );
  if (previousCeoId) await closeCeoTenure(db, sub._id, { holderId: previousCeoId, turn });
  await openCeoTenure(db, sub._id, { holderId: characterId, ceoType: "character", turn });

  return { ok: true, ceoType: "character" };
}
