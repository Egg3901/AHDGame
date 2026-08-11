/**
 * Sovereign auction outcome detection — runs once per country at fiscal-year close.
 *
 * Pipeline:
 *   1. Load federal-budget row.
 *   2. Skip if state ∈ {crisisPending, crisisResolving, recovering} (terminal-for-detection).
 *   3. Skip if no required issuance (no auction → no signal).
 *   4. Load demand snapshot, compute market demand.
 *   5. Classify outcome, derive new counter, compute next state.
 *   6. Persist state + counter + last-demand to federalBudget.
 *   7. On crisisPending entry: write fire timestamps, insert SovereignCrisisDecision, emit crisis news.
 *   8. Otherwise: emit undersubscribed/failed news for player visibility.
 *
 * Phase 4 only handles entry into `crisisPending`. Resolution paths and recovery
 * are owned by Phase 5+.
 */

import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalBudget, SovereignCrisisState } from "@/lib/db/types/budget";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { loadCountrySovereignSnapshot } from "./snapshotLoader";
import { computeMarketDemand } from "./marketDemand";
import { computeRequiredIssuance } from "./requiredIssuance";
import { classifyAuctionOutcome, type AuctionOutcome } from "./auctionOutcome";
import { computeNextCrisisState } from "./crisisState";
import {
  emitAuctionUndersubscribedNews,
  emitAuctionFailedNews,
  emitCrisisFiredNews,
} from "./crisisNews";
import {
  AUTONOMOUS_CRISIS_MIN_DEBT_TO_GDP,
  EXECUTIVE_DECISION_HOURS,
  EXECUTIVE_DECISION_TURNS,
} from "./constants";
import { EXTREME_DISTRESS_DEBT_TO_GDP } from "@/lib/budget/debt";
import { npcExecutiveAutoPropose } from "./npc/npcExecutiveAutoPropose";
import { applyPopulistSurgeOnCrisis } from "./political/applyPopulistSurge";
import { getCountryAccessFromDb } from "@/lib/countryAccess";

const MS_PER_HOUR = 60 * 60 * 1000;

export interface EvaluationSummary {
  countryCode: string;
  outcome: AuctionOutcome;
  demandRatio: number;
  newConsecutiveFailedCount: number;
  nextState: SovereignCrisisState;
  firedThisEvaluation: boolean;
}

export async function evaluateSovereignAuctionForCountry(
  db: Db,
  countryCode: CountryId,
  currentTurn: number,
  realtimeMs: number
): Promise<EvaluationSummary | null> {
  const budgetId = getNationalBudgetId(countryCode);
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  if (!budget) return null;

  const currentState: SovereignCrisisState = budget.sovereignCrisisState ?? "normal";
  // "recovering" is normally terminal-for-detection — Phase 5+ resolution
  // paths own transitions out of it. But a country whose STRUCTURAL deficit
  // never clears (refs #3813) can sit in "recovering" forever: the recovery
  // exit gate requires a primary-surplus streak that never arrives, so
  // `processTreasuryTurn`'s per-turn interest accrual (which runs
  // unconditionally, independent of crisis state) is free to reflate the
  // debt/GDP ratio right back past extreme distress with NO further check
  // ever running again — a defaulted-and-"recovered" country would silently
  // out-spiral its own default. Once a "recovering" country has genuinely
  // reflated back past the extreme-distress band, treat it as re-eligible
  // for detection exactly like a "normal" country, rather than shielding it
  // indefinitely.
  const recoveringButReflated =
    currentState === "recovering" && (budget.debtToGdpRatio ?? 0) >= EXTREME_DISTRESS_DEBT_TO_GDP;
  if (
    (currentState === "crisisPending" ||
      currentState === "crisisResolving" ||
      currentState === "recovering") &&
    !recoveringButReflated
  ) {
    return null;
  }
  const detectionState: SovereignCrisisState = recoveringButReflated ? "normal" : currentState;

  const required = await computeRequiredIssuance(db, countryCode, currentTurn);
  if (required <= 0) return null;

  const snapshot = await loadCountrySovereignSnapshot(db, countryCode, currentTurn);
  if (!snapshot) return null;

  const demand = computeMarketDemand(snapshot);
  const classified = classifyAuctionOutcome(demand.demandRatio);

  // Player-enabled gate: countries flagged "Coming Soon" (or with the
  // Players Enabled toggle off) in the admin panel must never tip into a
  // sovereign default. They still get scored — `/api/world/sovereign-watch`
  // recomputes demand + DSA fresh from the snapshot, so the dashboard stays
  // truthful — but we skip the failed-auction counter increment, the state
  // transition, decision-row creation, news, and the populist surge.
  //
  // We do persist `lastAuctionDemandRatio` so admin tools and raw-DB
  // inspection see the most recent market signal for the disabled country
  // (live consumers always recompute, so the persisted value is purely a
  // record-of-last-auction).
  //
  // Exception (refs #3236): an NPP-governed country (global autonomy ≥ v1 and
  // not player-enabled) with EXTREME fundamentals goes through the full
  // pipeline — the autonomy brain resolves the crisis the same way it does for
  // player-enabled countries (npcExecutiveAutoPropose fires immediately for
  // NPC/vacant executives, then NPC legislators ratify). Without this, fully
  // autonomous worlds could run debt/GDP past 300% with ratings, auctions, and
  // the crisis state machine all frozen. The debt/GDP floor keeps live-world
  // preview countries (nowhere near 200%) byte-identical to the old behavior.
  const access = await getCountryAccessFromDb(db, countryCode);
  const autonomousCrisisEligible =
    access.nppGoverned && snapshot.debtToGdp >= AUTONOMOUS_CRISIS_MIN_DEBT_TO_GDP;
  if (!access.enabledForPlayers && !autonomousCrisisEligible) {
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id: budgetId }, { $set: { lastAuctionDemandRatio: demand.demandRatio } });
    return {
      countryCode,
      outcome: classified.outcome,
      demandRatio: demand.demandRatio,
      // Counter is intentionally NOT incremented while disabled so a flip of
      // the toggle to Active doesn't immediately fire a crisis from auctions
      // accumulated during the preview window.
      newConsecutiveFailedCount: budget.failedAuctionConsecutiveCount ?? 0,
      nextState: currentState,
      firedThisEvaluation: false,
    };
  }

  const previousCount = budget.failedAuctionConsecutiveCount ?? 0;
  const newCount = classified.counterDelta === 0 ? 0 : previousCount + 1;

  const transition = computeNextCrisisState({
    current: detectionState,
    outcome: classified.outcome,
    newConsecutiveFailedCount: newCount,
  });

  const baseUpdate: Partial<FederalBudget> = {
    sovereignCrisisState: transition.nextState,
    failedAuctionConsecutiveCount: newCount,
    lastAuctionDemandRatio: demand.demandRatio,
  };

  if (transition.firedThisEvaluation) {
    baseUpdate.crisisFiredAt = { turn: currentTurn, realtimeMs };
    baseUpdate.crisisAutoActionAt = {
      turn: currentTurn + EXECUTIVE_DECISION_TURNS,
      realtimeMs: realtimeMs + EXECUTIVE_DECISION_HOURS * MS_PER_HOUR,
    };
  }

  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne({ _id: budgetId }, { $set: baseUpdate });

  if (transition.firedThisEvaluation) {
    const decision: SovereignCrisisDecision = {
      _id: new ObjectId(),
      countryCode,
      state: "open",
      firedAtTurn: currentTurn,
      firedAtRealtimeMs: realtimeMs,
      executiveChoice: null,
      executiveProposedAtRealtimeMs: null,
      // Phase 9 will derive this from country government type. Defaulting to
      // false here means the decision row is structurally complete but
      // legislative ratification wiring is intentionally deferred.
      requiresLegislativeRatification: false,
      legislativeBillId: null,
      resolvedAt: null,
      resolvedReason: null,
      createdAt: new Date(realtimeMs),
    };
    await db.collection<SovereignCrisisDecision>("sovereignCrisisDecisions").insertOne(decision);
    await emitCrisisFiredNews(countryCode, currentTurn);
    // Phase 10: NPC-controlled and vacant executives auto-propose immediately —
    // no 12-hour wait. Player executives skip this and use the UI within the
    // existing window. The auto-propose itself transitions the decision to
    // `executiveProposed` and the budget to `crisisResolving`.
    //
    // Wrap in try/catch: the crisis-fire transition above is already
    // committed (state, decision row, news). A failure in auto-propose must
    // not roll those back; the country falls through to the 12-hour
    // auto-Repudiate timer as the safety net.
    try {
      await npcExecutiveAutoPropose(db, {
        countryCode,
        decisionId: decision._id,
        currentTurn,
        realtimeMs,
      });
    } catch (err) {
      console.error("npcExecutiveAutoPropose threw at crisis-fire", err);
    }

    // Phase 11b: anti-establishment sentiment rises — populist/nationalist
    // NPPs in the affected country get a temporary favorability bump.
    // Best-effort.
    try {
      await applyPopulistSurgeOnCrisis(db, countryCode);
    } catch (err) {
      console.error("applyPopulistSurgeOnCrisis threw at crisis-fire", err);
    }
  } else if (classified.outcome === "undersubscribed") {
    await emitAuctionUndersubscribedNews(countryCode, demand.demandRatio);
  } else if (classified.outcome === "failed") {
    await emitAuctionFailedNews(countryCode, demand.demandRatio, newCount);
  }

  return {
    countryCode,
    outcome: classified.outcome,
    demandRatio: demand.demandRatio,
    newConsecutiveFailedCount: newCount,
    nextState: transition.nextState,
    firedThisEvaluation: transition.firedThisEvaluation,
  };
}
