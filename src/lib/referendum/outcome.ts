import { withSessionDb, afterCommit } from "@/lib/db/sessionDb";
/**
 * Apply a resolved referendum's outcome.
 *
 * Phase 0: a YES result moves the referendum to `actuating` and records a
 * `referendum_passed` country-history event noting it awaits admin confirmation
 * — the map-changing actuation (secedeRegion / transferRegion) lands in later
 * phases. A NO result settles the referendum, dampens the region's
 * independenceDesire back to the unionist baseline, and starts the long
 * cooldown.
 *
 * Mirrors the atomic-write + fire-and-forget history idiom of
 * `triggerSystemConversion`.
 */
import type { Db } from "mongodb";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import type { Referendum } from "@/lib/db/types/referendum";
import { getReferendumCollection } from "@/lib/db/collections/referendum";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import {
  createReunificationConsentBills,
  createIndependenceConsentBill,
} from "@/lib/referendum/reunificationBills";
import { announceReferendumVoteResult } from "@/lib/referendum/referendumWebhooks";
import { recordWireEvent } from "@/lib/referendum/wire";
import {
  CONVERSION_WINDOW_TURNS,
  SETTLED_COOLDOWN_TURNS,
  SETTLED_DESIRE_TARGET,
} from "@/lib/constants/referendum";

export interface ReferendumVoteOutcome {
  finalYesShare: number;
  turnout: number;
  passed: boolean;
}

export async function applyReferendumOutcome(
  db: Db,
  ref: Referendum,
  outcome: ReferendumVoteOutcome,
  currentTurn: number
): Promise<boolean> {
  return withSessionDb(db, (transactionDb) =>
    applyReferendumOutcomeInTransaction(transactionDb, ref, outcome, currentTurn)
  );
}

async function applyReferendumOutcomeInTransaction(
  db: Db,
  ref: Referendum,
  outcome: ReferendumVoteOutcome,
  currentTurn: number
): Promise<boolean> {
  const refs = getReferendumCollection(db);
  const now = new Date();
  const result = { ...outcome, resolvedTurn: currentTurn };

  if (ref.kind === "peace_agreement") {
    // This public mandate concerns institutions, never a territorial transfer.
    // CAS preserves the first persisted count if a polling turn is retried.
    const written = await refs.updateOne(
      { _id: ref._id, status: "polling", result: null },
      {
        $set: {
          status: outcome.passed ? "completed" : "settled",
          result,
          yesShare: outcome.finalYesShare,
          updatedAt: now,
        },
      }
    );
    if (written.modifiedCount === 0) return false;
    await recordWireEvent(db, {
      referendumId: ref._id!,
      countryId: ref.countryId,
      regionId: ref.regionId,
      turn: currentTurn,
      kind: "vote",
      side: outcome.passed ? "yes" : "no",
      summary: `Northern Ireland ${outcome.passed ? "ratified" : "rejected"} the peace agreement with ${outcome.finalYesShare.toFixed(1)}% Yes.`,
    }).catch(() => {});
    await afterCommit(db, () => announceReferendumVoteResult(ref, outcome).catch(() => {}));
    return true;
  }

  // Claim the territorial count before creating bills. The claim, bills and
  // metric reset commit together; a stale/retried count creates no side effects.
  const claimed = await refs.updateOne(
    { _id: ref._id, status: "polling", result: null },
    {
      $set: {
        status: outcome.passed ? "actuating" : "settled",
        result,
        yesShare: outcome.finalYesShare,
        ...(outcome.passed ? {} : { cooldownReadyAtTurn: currentTurn + SETTLED_COOLDOWN_TURNS }),
        updatedAt: now,
      },
    }
  );
  if (claimed.modifiedCount === 0) return false;

  if (outcome.passed) {
    // Both kinds open a conversion window with parliamentary consent. Reunification
    // always needs Westminster consent and also needs Dáil consent when Ireland is
    // already player enabled. Independence needs only Westminster consent.
    const conversionDeadlineTurn =
      ref.kind === "reunification" || ref.kind === "independence"
        ? currentTurn + CONVERSION_WINDOW_TURNS
        : null;
    const bills =
      ref.kind === "reunification"
        ? await createReunificationConsentBills(db, { ...ref, result }, currentTurn)
        : ref.kind === "independence"
          ? {
              ...(await createIndependenceConsentBill(db, { ...ref, result }, currentTurn)),
              dailBillId: null,
            }
          : { westminsterBillId: null, dailBillId: null };
    await refs.updateOne(
      { _id: ref._id },
      {
        $set: {
          status: "actuating",
          result,
          conversionDeadlineTurn,
          westminsterBillId: bills.westminsterBillId,
          dailBillId: bills.dailBillId,
          updatedAt: now,
        },
      }
    );
    await recordCountryEvent(db, {
      countryId: ref.countryId,
      turn: currentTurn,
      eventType: "referendum_passed",
      title:
        ref.kind === "reunification"
          ? `${ref.regionId} votes to rejoin Ireland`
          : `${ref.regionId} votes for independence`,
      details: {
        regionId: ref.regionId,
        kind: ref.kind,
        targetCountryId: ref.targetCountryId,
        finalYesShare: outcome.finalYesShare,
        turnout: outcome.turnout,
        conversionDeadlineTurn,
        note: "Parliamentary consent voting is open; conversion follows enactment.",
      },
    }).catch((err) =>
      console.error(`${ref.regionId} referendum_passed history write failed:`, err)
    );
    await afterCommit(db, () =>
      announceReferendumVoteResult(ref, {
        passed: true,
        finalYesShare: outcome.finalYesShare,
        dailConsentRequired: bills.dailBillId != null,
      }).catch(() => {})
    );
    await recordWireEvent(db, {
      referendumId: ref._id!,
      countryId: ref.countryId,
      regionId: ref.regionId,
      turn: currentTurn,
      kind: "vote",
      side: "yes",
      summary: `Carried at the ballot box — ${Math.round(outcome.finalYesShare)}% Yes.`,
    }).catch(() => {});
    return true;
  }

  // SP5: independenceDesire lives top-level on macroMetrics.
  await db.collection<MacroMetricsDoc>("macroMetrics").updateOne(
    { _id: ref.regionId },
    {
      $set: {
        independenceDesire: { value: SETTLED_DESIRE_TARGET, trend: 0 },
        lastUpdated: now,
      },
    }
  );
  await recordCountryEvent(db, {
    countryId: ref.countryId,
    turn: currentTurn,
    eventType: "referendum_failed",
    title: `${ref.regionId} referendum fails`,
    details: {
      regionId: ref.regionId,
      kind: ref.kind,
      finalYesShare: outcome.finalYesShare,
      turnout: outcome.turnout,
    },
  }).catch((err) => console.error(`${ref.regionId} referendum_failed history write failed:`, err));
  await afterCommit(db, () =>
    announceReferendumVoteResult(ref, {
      passed: false,
      finalYesShare: outcome.finalYesShare,
    }).catch(() => {})
  );
  await recordWireEvent(db, {
    referendumId: ref._id!,
    countryId: ref.countryId,
    regionId: ref.regionId,
    turn: currentTurn,
    kind: "settled",
    side: "no",
    summary: `Defeated — ${Math.round(outcome.finalYesShare)}% Yes.`,
  }).catch(() => {});
  return true;
}
