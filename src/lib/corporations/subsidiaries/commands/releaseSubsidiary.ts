import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { dismissCaretakerCeo } from "@/lib/corporations/caretakerCeo";
import { canActOnCorporationAsParent } from "../authorization";
import { SUBSIDIARY_MIN_AGE_TURNS } from "../constants";
import { fail, type SubsidiaryCommandResult } from "../commandTypes";

export interface ReleaseSubsidiaryInput {
  sub: Corporation;
  callerUserId: ObjectId;
  dismissCaretaker?: boolean;
  turn: number;
  now: Date;
}

/**
 * Parent stops managing the subsidiary (without necessarily selling shares).
 * Clears the formalization marker and dividend-floor fields; optionally dismisses
 * an NPP caretaker the parent installed (restoring the underlying human).
 */
export async function releaseSubsidiary(
  db: Db,
  input: ReleaseSubsidiaryInput
): Promise<SubsidiaryCommandResult<{ caretakerDismissed: boolean }>> {
  const { sub, callerUserId, dismissCaretaker, turn, now } = input;

  if (!(await canActOnCorporationAsParent(db, callerUserId, sub))) {
    return fail("You are not authorized to manage this subsidiary.", 403);
  }

  if (sub.subsidiaryFormalizedAtTurn == null) {
    return fail("This corporation is not a formalized subsidiary.");
  }
  if (turn - sub.subsidiaryFormalizedAtTurn < SUBSIDIARY_MIN_AGE_TURNS) {
    const remaining = SUBSIDIARY_MIN_AGE_TURNS - (turn - sub.subsidiaryFormalizedAtTurn);
    return fail(`A subsidiary cannot be released for another ${remaining} turn(s).`);
  }

  let caretakerDismissed = false;
  if (dismissCaretaker && sub.caretakerCeo) {
    const dismiss = await dismissCaretakerCeo(db, { corp: sub, turn, now });
    caretakerDismissed = dismiss.ok;
  }

  await db.collection<Corporation>("corporations").updateOne(
    { _id: sub._id },
    {
      $unset: {
        subsidiaryFormalizedAtTurn: "",
        parentDividendFloorPct: "",
        parentDividendFloorSetByCorpId: "",
      },
      $set: { updatedAt: now },
    }
  );

  return { ok: true, caretakerDismissed };
}
