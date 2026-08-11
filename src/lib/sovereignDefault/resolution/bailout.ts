/**
 * IMF Bailout resolution path — Phase 5.
 *
 * For Phase 5, executive submission auto-ratifies the decision (skipping the
 * `crisisResolving` legislative state). Phase 9 will gate this behind the
 * bicameral ratification flow for democracies.
 */

import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalBudget, SovereignCrisisState } from "@/lib/db/types/budget";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";
import { getNationalBudgetId, calculateSovereignRolloverAmount } from "@/lib/bonds/sovereign";
import { getImfCorporation } from "@/lib/imf/resolveImfCorporation";
import { computeSovereignBailoutTerms, type SovereignBailoutTerms } from "../imfSovereignFacility";
import { IMF_BOARD_OVERRIDE_WINDOW_HOURS, IMF_BOARD_OVERRIDE_WINDOW_TURNS } from "../constants";
import { emitBailoutGrantedNews } from "../crisisNews";
import { applyExecutivePoliticalImpact } from "../political/executivePoliticalImpact";
import { emitCivilUnrestEvents } from "../political/civilUnrestEvents";

const MS_PER_HOUR = 60 * 60 * 1000;

export interface BailoutResolutionInput {
  countryCode: CountryId;
  currentTurn: number;
  realtimeMs: number;
  decisionId: ObjectId;
  executiveCharacterId: ObjectId | null;
  /**
   * When true, the orchestrator skips updating the SovereignCrisisDecision row.
   * The legislative-turn processor is already authoritative for that row in
   * the ratification flow — calling its update first then having the
   * orchestrator overwrite would clobber `state` (rejected→ratified collision
   * on auto-Repudiate) and `executiveProposedAtRealtimeMs` (the original
   * proposal time would be replaced by the ratification time).
   */
  skipDecisionUpdate?: boolean;
}

export interface BailoutResolutionResult {
  ok: boolean;
  reason?: "not-in-crisisPending" | "no-budget" | "no-imf-corp";
  termsApplied?: SovereignBailoutTerms;
}

export async function applyBailoutResolution(
  db: Db,
  input: BailoutResolutionInput
): Promise<BailoutResolutionResult> {
  const { countryCode, currentTurn, realtimeMs, decisionId } = input;

  const budgetId = getNationalBudgetId(countryCode);
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  if (!budget) return { ok: false, reason: "no-budget" };

  const state: SovereignCrisisState = budget.sovereignCrisisState ?? "normal";
  if (state !== "crisisPending" && state !== "crisisResolving") {
    return { ok: false, reason: "not-in-crisisPending" };
  }

  const imfCorp = await getImfCorporation(db);
  if (!imfCorp) return { ok: false, reason: "no-imf-corp" };

  const rollover = await calculateSovereignRolloverAmount(db, countryCode, currentTurn);
  const annualDeficit = Math.max(0, -(budget.surplus ?? 0));
  const terms = computeSovereignBailoutTerms({
    rolloverFaceValue: rollover,
    annualDeficit,
  });

  const update: Partial<FederalBudget> = {
    imfSovereignBailoutActive: true,
    imfSovereignFacilityPrincipalOutstanding: terms.principal,
    imfSovereignFacilityAnnualRate: terms.annualRatePercent,
    imfSovereignFacilityAmortizationTurnsRemaining: terms.amortizationTurns,
    imfSovereignFacilityIncomeCaptureFraction: terms.incomeCaptureFraction,
    imfSovereignFacilityImfCorporationId: imfCorp._id,
    crisisChoice: "bailout",
    crisisChoiceAt: { turn: currentTurn, realtimeMs },
    sovereignCrisisState: "recovering",
    recoveryStartedAt: { turn: currentTurn },
    lastDefaultTurn: currentTurn,
    recoveryFiscalDisciplineStreak: 0,
    imfBoardOverrideWindowEndAt: {
      turn: currentTurn + IMF_BOARD_OVERRIDE_WINDOW_TURNS,
      realtimeMs: realtimeMs + IMF_BOARD_OVERRIDE_WINDOW_HOURS * MS_PER_HOUR,
    },
    crisisAutoActionAt: null,
    crisisLegislativeDeadlineAt: null,
  };

  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne({ _id: budgetId }, { $set: update });

  if (!input.skipDecisionUpdate) {
    const decisionUpdate: Partial<SovereignCrisisDecision> = {
      state: "ratified",
      executiveChoice: "bailout",
      executiveProposedAtRealtimeMs: realtimeMs,
      resolvedAt: new Date(realtimeMs),
      resolvedReason: "IMF bailout granted (phase 5 auto-ratify)",
    };
    await db
      .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
      .updateOne({ _id: decisionId }, { $set: decisionUpdate });
  }

  await emitBailoutGrantedNews(countryCode, currentTurn, terms.principal);

  // Phase 11b: hit the proposing character with calibrated favorability/infamy
  // delta. Re-read the decision so we get the proposer who actually made the
  // call (may differ from the current executive at ratification time).
  const decision = await db
    .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
    .findOne({ _id: decisionId });
  await applyExecutivePoliticalImpact(db, decision?.proposingCharacterId ?? null, "bailout");

  // Phase 11b: civil-unrest event chain (1 event for the bailout path).
  try {
    await emitCivilUnrestEvents(db, countryCode, "bailout");
  } catch (err) {
    console.error("emitCivilUnrestEvents (bailout) failed", err);
  }

  return { ok: true, termsApplied: terms };
}
