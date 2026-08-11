import { type Db } from "mongodb";
import type { Bill } from "@/lib/db/types";
import type { CrisisAidCommitment } from "@/lib/db/types/crisisAid";
import { AID_FAILED_PENALTY, AID_PENALTY_TURNS } from "@/lib/constants/crises";
import { creditTreasury } from "@/lib/budget/treasurySpend";
import { applyEffectsForCrisis } from "@/lib/crises/interactionEngine";
import { applyCrisisEffects } from "@/lib/crises/applyEffects";
import { logWireEvent } from "@/lib/wireEvent";
import type { CrisisEffect } from "@/lib/db/types/crisis";

/**
 * Classify a bill status as a resolved aid outcome, or null if still in flight.
 *
 * Returning null for non-terminal statuses (incl. `vetoed`/`veto_override`/
 * `enrolled`/`cabinet_review`/`filibustered`) leaves the commitment `pending`.
 * This is safe ONLY because the federal bill engine never *terminates* at
 * `vetoed`: a veto becomes `veto_override`, the override window force-resolves to
 * `signed`/`override_failed`, and unattended `enrolled` bills pocket-sign. If a
 * country is ever added whose bills can permanently rest at `vetoed`, add it to
 * the failed set below — otherwise its aid commitment would never clawback.
 */
export function isResolvedBillStatus(status: Bill["status"]): "passed" | "failed" | null {
  if (status === "signed") return "passed";
  if (status === "failed" || status === "withdrawn" || status === "override_failed")
    return "failed";
  return null;
}

function negate(effects: CrisisEffect[]): CrisisEffect[] {
  return effects.map((e) => ({ ...e, value: -e.value }));
}

async function incApproval(db: Db, countryId: string, delta: number): Promise<void> {
  await db
    .collection("governmentApprovals")
    .updateOne(
      { _id: countryId as unknown as import("mongodb").ObjectId },
      { $inc: { approvalRating: delta } }
    );
}

/** Finalize a single resolved commitment: pass = stands; fail = clawback + penalty. */
export async function finalizeCrisisAid(
  db: Db,
  commitment: CrisisAidCommitment,
  passed: boolean,
  currentTurn: number
): Promise<void> {
  const now = new Date();
  if (passed) {
    await db
      .collection<CrisisAidCommitment>("crisisAidCommitments")
      .updateOne(
        { _id: commitment._id, status: "pending" },
        { $set: { status: "passed", resolvedAt: now, updatedAt: now } }
      );
    await logWireEvent(
      "crisis_aid_passed",
      `Emergency aid from ${commitment.senderCountryId} was approved.`,
      {
        href: `/world/crises/${commitment.crisisId.toString()}`,
      }
    );
    return;
  }

  // Clawback: reverse provisional effects, refund treasury, apply penalty.
  await applyEffectsForCrisis(db, commitment.crisisId, negate(commitment.recoveryEffects));
  await applyCrisisEffects(db, negate(commitment.senderEffects), [], [commitment.senderCountryId]);
  await creditTreasury(db, commitment.senderCountryId, commitment.treasuryDebited, {
    resyncDerived: true,
  });
  await incApproval(db, commitment.senderCountryId, -AID_FAILED_PENALTY);

  await db.collection<CrisisAidCommitment>("crisisAidCommitments").updateOne(
    { _id: commitment._id, status: "pending" },
    {
      $set: {
        status: "failed",
        approvalPenaltyExpiresTurn: currentTurn + AID_PENALTY_TURNS,
        penaltyReversed: false,
        resolvedAt: now,
        updatedAt: now,
      },
    }
  );
  await logWireEvent(
    "crisis_aid_failed",
    `${commitment.senderCountryId}'s aid bill failed; the pledge was clawed back.`,
    {
      href: `/world/crises/${commitment.crisisId.toString()}`,
    }
  );
}

/** Sweep pending commitments whose bills have resolved; finalize each. */
export async function processCrisisAidResolutions(
  db: Db,
  currentTurn: number
): Promise<{ passed: number; failed: number }> {
  const pending = await db
    .collection<CrisisAidCommitment>("crisisAidCommitments")
    .find({ status: "pending" })
    .toArray();
  let passed = 0;
  let failed = 0;
  for (const c of pending) {
    const bill = await db.collection<Bill>("bills").findOne({ _id: c.billId });
    if (!bill) continue;
    const outcome = isResolvedBillStatus(bill.status);
    if (!outcome) continue;
    await finalizeCrisisAid(db, c, outcome === "passed", currentTurn);
    if (outcome === "passed") passed++;
    else failed++;
  }
  return { passed, failed };
}

/** Reverse expired failed-vote approval penalties exactly once. */
export async function reverseCrisisAidPenalties(db: Db, currentTurn: number): Promise<number> {
  const due = await db
    .collection<CrisisAidCommitment>("crisisAidCommitments")
    .find({
      status: "failed",
      penaltyReversed: { $ne: true },
      approvalPenaltyExpiresTurn: { $lte: currentTurn },
    })
    .toArray();
  for (const c of due) {
    await incApproval(db, c.senderCountryId, AID_FAILED_PENALTY);
    await db
      .collection<CrisisAidCommitment>("crisisAidCommitments")
      .updateOne(
        { _id: c._id, penaltyReversed: { $ne: true } },
        { $set: { penaltyReversed: true, updatedAt: new Date() } }
      );
  }
  return due.length;
}
