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
): Promise<void> {
  const refs = getReferendumCollection(db);
  const now = new Date();
  const result = { ...outcome, resolvedTurn: currentTurn };

  if (outcome.passed) {
    // Open the conversion window. Only reunification has an actuation engine
    // today, so only it gets an auto-convert deadline; independence sits in
    // `actuating` until the secession engine (Phases 2–3). Admins can still
    // resolve/block either via the admin route.
    // Both kinds open a conversion window with parliamentary consent: reunification
    // needs BOTH a Westminster (UK releases NI) and a Dáil (Ireland admits NI) bill;
    // independence needs only the single Westminster bill (UK releases the region —
    // there is no admitting parliament). The actuation runs once the bill(s) pass.
    const conversionDeadlineTurn =
      ref.kind === "reunification" || ref.kind === "independence"
        ? currentTurn + CONVERSION_WINDOW_TURNS
        : null;
    const bills =
      ref.kind === "reunification"
        ? await createReunificationConsentBills(db, ref, currentTurn)
        : ref.kind === "independence"
          ? { ...(await createIndependenceConsentBill(db, ref, currentTurn)), dailBillId: null }
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
        note: "Conversion window open — admin may resolve early or block; else auto-converts.",
      },
    }).catch((err) =>
      console.error(`${ref.regionId} referendum_passed history write failed:`, err)
    );
    await announceReferendumVoteResult(ref, {
      passed: true,
      finalYesShare: outcome.finalYesShare,
    }).catch(() => {});
    await recordWireEvent(db, {
      referendumId: ref._id!,
      countryId: ref.countryId,
      regionId: ref.regionId,
      turn: currentTurn,
      kind: "vote",
      side: "yes",
      summary: `Carried at the ballot box — ${Math.round(outcome.finalYesShare)}% Yes.`,
    }).catch(() => {});
    return;
  }

  await refs.updateOne(
    { _id: ref._id },
    {
      $set: {
        status: "settled",
        result,
        cooldownReadyAtTurn: currentTurn + SETTLED_COOLDOWN_TURNS,
        updatedAt: now,
      },
    }
  );
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
  await announceReferendumVoteResult(ref, {
    passed: false,
    finalYesShare: outcome.finalYesShare,
  }).catch(() => {});
  await recordWireEvent(db, {
    referendumId: ref._id!,
    countryId: ref.countryId,
    regionId: ref.regionId,
    turn: currentTurn,
    kind: "settled",
    side: "no",
    summary: `Defeated — ${Math.round(outcome.finalYesShare)}% Yes.`,
  }).catch(() => {});
}
