/**
 * Per-turn processor for sovereign-crisis legislative ratification.
 *
 * Per "executiveProposed" decision:
 *   1. Find the active phase via currentChamberIndex.
 *   2. Skip if outcome is no longer pending or window hasn't expired.
 *   3. Tally: votesFor > votesAgainst → passed; otherwise rejected.
 *   4. Rejected → mark decision rejected and auto-Repudiate the country.
 *   5. Passed → stamp phase outcome; if upper chamber exists and we just
 *      cleared the lower, append the upper phase + advance index.
 *      Otherwise: ratified — dispatch to the chosen Phase 5/6 orchestrator.
 *
 * Idempotent: re-running is a no-op for decisions in terminal states.
 */

import { type Db, type ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";
import { tallyChamberOutcome } from "./tallyChamberOutcome";
import { buildUpperChamberPhase } from "./buildPhases";
import { applyRepudiateResolution } from "@/lib/sovereignDefault/resolution/repudiate";
import { applyRestructureResolution } from "@/lib/sovereignDefault/resolution/restructure";
import { applyBailoutResolution } from "@/lib/sovereignDefault/resolution/bailout";
import { applyMonetizeResolution } from "@/lib/sovereignDefault/resolution/monetize";
import { runNpcLegislatorAutoVote } from "@/lib/sovereignDefault/npc/npcLegislatorAutoVote";
import { applyLegislatorImpactsForChamber } from "./applyLegislatorImpactsForChamber";

export interface LegislativeTurnReport {
  decisionsEvaluated: number;
  ratified: string[];
  rejected: string[];
  advanced: string[];
}

export async function processSovereignLegislativeTurn(
  db: Db,
  realtimeMs: number,
  currentTurn: number
): Promise<LegislativeTurnReport> {
  const decisions = await db
    .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
    .find({ state: "executiveProposed" })
    .toArray();

  const report: LegislativeTurnReport = {
    decisionsEvaluated: decisions.length,
    ratified: [],
    rejected: [],
    advanced: [],
  };

  for (const decision of decisions) {
    const idx = decision.currentChamberIndex ?? -1;
    const phases = decision.legislativePhases ?? [];
    const phase = phases[idx];
    if (!phase) continue;
    if (phase.outcome !== "pending") continue;

    // Phase 10: NPC legislators auto-vote every turn the chamber is open
    // (idempotent per-NPP via dotted-key $exists filter). Run BEFORE the
    // deadline check so even on the deadline turn NPC votes are recorded.
    await runNpcLegislatorAutoVote(db, {
      decision,
      chamberIndex: idx,
      countryCode: decision.countryCode as CountryId,
    });

    // Turn-first window close (freezes on pause) with a wall-clock fallback for
    // phases opened before `endsOnTurn` existed.
    const windowStillOpen =
      typeof phase.endsOnTurn === "number"
        ? phase.endsOnTurn > currentTurn
        : phase.endsAtRealtimeMs > realtimeMs;
    if (windowStillOpen) continue;

    // Re-fetch the phase from the latest decision row so the tally sees
    // any NPC votes that just landed. CRITICAL: also use the refreshed
    // `phases` array as the basis for any subsequent
    // `legislativePhases: updatedPhases` write — otherwise we'd overwrite the
    // votes map with stale in-memory data and lose the NPC votes.
    const refreshed = await db
      .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
      .findOne({ _id: decision._id as ObjectId });
    const livePhases = refreshed?.legislativePhases ?? phases;
    const refreshedPhase = livePhases[idx];
    const outcome = tallyChamberOutcome(refreshedPhase ?? phase);

    // Phase 11b: per-voter favorability deltas. Defined here, called below
    // AFTER each branch's decision-row update so a mid-process crash leaves
    // the phase already stamped (`outcome !== "pending"`), preventing
    // double-apply on re-run.
    const applyImpactsAfterTally = async () => {
      if (!refreshedPhase || !decision.executiveChoice) return;
      try {
        await applyLegislatorImpactsForChamber(
          db,
          refreshedPhase.votes ?? {},
          decision.executiveChoice
        );
      } catch (err) {
        console.error("applyLegislatorImpactsForChamber failed", err);
      }
    };

    if (outcome === "rejected") {
      const updatedPhases = livePhases.map((p, i) => (i === idx ? { ...p, outcome } : p));
      await db.collection<SovereignCrisisDecision>("sovereignCrisisDecisions").updateOne(
        { _id: decision._id as ObjectId },
        {
          $set: {
            state: "rejected",
            currentChamberIndex: null,
            legislativePhases: updatedPhases,
            resolvedAt: new Date(realtimeMs),
            resolvedReason: "Legislative deadlock — auto-Repudiate (phase 9b)",
          },
        }
      );
      await applyImpactsAfterTally();
      await applyRepudiateResolution(db, {
        countryCode: decision.countryCode as CountryId,
        currentTurn,
        realtimeMs,
        decisionId: decision._id as ObjectId,
        executiveCharacterId: null,
        // legislativeTurn already wrote the authoritative decision row
        // (state="rejected", resolvedReason="Legislative deadlock — auto-Repudiate").
        // Without this flag the orchestrator would overwrite state→"ratified"
        // and executiveChoice→"repudiate", erasing the rejection record.
        skipDecisionUpdate: true,
      });
      report.rejected.push(decision.countryCode);
      continue;
    }

    // passed — check whether to advance to upper or ratify.
    const isLowerJustPassed = idx === 0;
    const upperPhase = isLowerJustPassed
      ? buildUpperChamberPhase(decision.countryCode as CountryId, realtimeMs, currentTurn)
      : null;

    if (upperPhase) {
      const updatedPhases = livePhases.map((p, i) => (i === idx ? { ...p, outcome } : p));
      updatedPhases.push(upperPhase);
      await db.collection<SovereignCrisisDecision>("sovereignCrisisDecisions").updateOne(
        { _id: decision._id as ObjectId },
        {
          $set: {
            currentChamberIndex: idx + 1,
            legislativePhases: updatedPhases,
          },
        }
      );
      await applyImpactsAfterTally();
      report.advanced.push(decision.countryCode);
      continue;
    }

    // ratified — final chamber passed, run the orchestrator.
    const updatedPhases = livePhases.map((p, i) => (i === idx ? { ...p, outcome } : p));

    const baseInput = {
      countryCode: decision.countryCode as CountryId,
      currentTurn,
      realtimeMs,
      decisionId: decision._id as ObjectId,
      executiveCharacterId: null,
      // legislativeTurn writes the authoritative decision row immediately
      // after the orchestrator returns. Without this flag the orchestrator
      // would also overwrite the row, clobbering the original
      // `executiveProposedAtRealtimeMs` (the executive's proposal time, not
      // the ratification time).
      skipDecisionUpdate: true,
    };
    let orchestratorOk = true;
    let orchestratorReason: string | undefined;
    switch (decision.executiveChoice) {
      case "bailout": {
        const r = await applyBailoutResolution(db, baseInput);
        orchestratorOk = r.ok;
        orchestratorReason = r.reason;
        break;
      }
      case "repudiate": {
        const r = await applyRepudiateResolution(db, baseInput);
        orchestratorOk = r.ok;
        orchestratorReason = r.reason;
        break;
      }
      case "restructure": {
        const r = await applyRestructureResolution(db, baseInput);
        orchestratorOk = r.ok;
        orchestratorReason = r.reason;
        break;
      }
      case "monetize": {
        const r = await applyMonetizeResolution(db, baseInput);
        orchestratorOk = r.ok;
        orchestratorReason = r.reason;
        break;
      }
    }

    // Fallback: if the orchestrator refused (e.g. monetize-gated-by-inflation
    // because inflation rose past 8% during the 24-48h ratification window),
    // we cannot leave the country stuck in "crisisResolving" with the
    // decision marked ratified but no mutation applied. Auto-fall-back to
    // Repudiate so the country state machine moves forward.
    if (!orchestratorOk) {
      await applyRepudiateResolution(db, {
        ...baseInput,
        skipDecisionUpdate: true,
      });
      await db.collection<SovereignCrisisDecision>("sovereignCrisisDecisions").updateOne(
        { _id: decision._id as ObjectId },
        {
          $set: {
            state: "ratified",
            currentChamberIndex: null,
            legislativePhases: updatedPhases,
            resolvedAt: new Date(realtimeMs),
            resolvedReason: `Legislative ratification ${decision.executiveChoice} infeasible (${orchestratorReason ?? "unknown"}); fell back to Repudiate (phase 9b)`,
          },
        }
      );
      await applyImpactsAfterTally();
      report.ratified.push(decision.countryCode);
      continue;
    }

    await db.collection<SovereignCrisisDecision>("sovereignCrisisDecisions").updateOne(
      { _id: decision._id as ObjectId },
      {
        $set: {
          state: "ratified",
          currentChamberIndex: null,
          legislativePhases: updatedPhases,
          resolvedAt: new Date(realtimeMs),
          resolvedReason: "Legislative ratification complete (phase 9b)",
        },
      }
    );
    await applyImpactsAfterTally();
    report.ratified.push(decision.countryCode);
  }

  return report;
}
