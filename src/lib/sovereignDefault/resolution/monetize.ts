/**
 * Monetize resolution path — Phase 6.
 *
 * Central bank prints the financing gap to cover next-quarter rollover and
 * the annual deficit. Inflation spikes by `printedAmount/GDP * SHOCK_MULTIPLIER`
 * and FX depreciates by 40% of that fraction. No bond mutations, no market
 * lockout. Country state still moves to recovering.
 *
 * Hard-gated when current inflation > MONETIZE_GATE_INFLATION (8%).
 */

import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalBudget, SovereignCrisisState } from "@/lib/db/types/budget";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";
import { getNationalBudgetId, calculateSovereignRolloverAmount } from "@/lib/bonds/sovereign";
import { applyExchangeRateDepreciation } from "../sideEffects/fxDepreciation";
import { emitMonetizedNews } from "../crisisNews";
import { applyExecutivePoliticalImpact } from "../political/executivePoliticalImpact";
import { triggerSystemNoConfidence } from "../political/triggerSystemNoConfidence";
import { emitCivilUnrestEvents } from "../political/civilUnrestEvents";
import { MONETIZE_GATE_INFLATION, INFLATION_SHOCK_MULTIPLIER } from "../constants";

const MONETIZE_FX_COUPLING = 0.4;

export interface MonetizeResolutionInput {
  countryCode: CountryId;
  currentTurn: number;
  realtimeMs: number;
  decisionId: ObjectId;
  executiveCharacterId: ObjectId | null;
  /**
   * When true, the orchestrator skips updating the SovereignCrisisDecision row.
   * The legislative-turn processor is already authoritative for that row in
   * the ratification flow — calling its update first then having the
   * orchestrator overwrite would clobber `state` and
   * `executiveProposedAtRealtimeMs`.
   */
  skipDecisionUpdate?: boolean;
}

export interface MonetizeResolutionResult {
  ok: boolean;
  reason?: "not-in-crisisPending" | "no-budget" | "monetize-gated-by-inflation";
  printedAmount?: number;
  inflationShockPp?: number;
}

export async function applyMonetizeResolution(
  db: Db,
  input: MonetizeResolutionInput
): Promise<MonetizeResolutionResult> {
  const { countryCode, currentTurn, realtimeMs, decisionId } = input;

  const budgetId = getNationalBudgetId(countryCode);
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  if (!budget) return { ok: false, reason: "no-budget" };

  const state: SovereignCrisisState = budget.sovereignCrisisState ?? "normal";
  if (state !== "crisisPending" && state !== "crisisResolving") {
    return { ok: false, reason: "not-in-crisisPending" };
  }

  // AHD stores inflationRate as percentage points (3.94 = 3.94%); the gate is
  // a fractional 0.08 (8%). Use `>` so exactly 8% remains allowed.
  const inflationFraction = (budget.economicFactors?.inflationRate ?? 0) / 100;
  if (inflationFraction > MONETIZE_GATE_INFLATION) {
    return { ok: false, reason: "monetize-gated-by-inflation" };
  }

  const rollover = await calculateSovereignRolloverAmount(db, countryCode, currentTurn);
  const annualDeficit = Math.max(0, -(budget.surplus ?? 0));
  const printedAmount = rollover + annualDeficit;

  const gdp = budget.gdp ?? 0;
  const inflationShockFraction = gdp > 0 ? (printedAmount / gdp) * INFLATION_SHOCK_MULTIPLIER : 0;
  const inflationShockPp = inflationShockFraction * 100;

  const newInflationPp = (budget.economicFactors?.inflationRate ?? 0) + inflationShockPp;

  if (inflationShockFraction > 0) {
    await applyExchangeRateDepreciation(
      db,
      countryCode,
      inflationShockFraction * MONETIZE_FX_COUPLING
    );
  }

  // Use dotted-key set so we don't have to read+rewrite the whole
  // economicFactors sub-document.
  const update: Record<string, unknown> = {
    crisisChoice: "monetize",
    crisisChoiceAt: { turn: currentTurn, realtimeMs },
    sovereignCrisisState: "recovering",
    recoveryStartedAt: { turn: currentTurn },
    lastDefaultTurn: currentTurn,
    recoveryFiscalDisciplineStreak: 0,
    marketAccessLockedUntilTurn: null,
    recoveryGdpPenaltyPercent: null,
    recoveryGdpPenaltyTurnsRemaining: null,
    "economicFactors.inflationRate": newInflationPp,
    crisisAutoActionAt: null,
    crisisLegislativeDeadlineAt: null,
  };

  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne({ _id: budgetId }, { $set: update });

  if (!input.skipDecisionUpdate) {
    const decisionUpdate: Partial<SovereignCrisisDecision> = {
      state: "ratified",
      executiveChoice: "monetize",
      executiveProposedAtRealtimeMs: realtimeMs,
      resolvedAt: new Date(realtimeMs),
      resolvedReason: "Sovereign debt monetized (phase 6 auto-ratify)",
    };
    await db
      .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
      .updateOne({ _id: decisionId }, { $set: decisionUpdate });
  }

  await emitMonetizedNews(countryCode, currentTurn, printedAmount, inflationShockPp);

  // Phase 11b: executive personal political impact (inflation always wrecks
  // incumbents).
  const decision = await db
    .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
    .findOne({ _id: decisionId });
  await applyExecutivePoliticalImpact(db, decision?.proposingCharacterId ?? null, "monetize");

  // Phase 11b: parliamentary countries auto-trigger no-confidence after Monetize.
  try {
    await triggerSystemNoConfidence(
      db,
      countryCode,
      "Sovereign-debt monetization (inflation shock)",
      currentTurn
    );
  } catch (err) {
    console.error("triggerSystemNoConfidence (monetize) failed", err);
  }

  // Phase 11b: civil-unrest events (2 for monetize — inflation shock).
  try {
    await emitCivilUnrestEvents(db, countryCode, "monetize");
  } catch (err) {
    console.error("emitCivilUnrestEvents (monetize) failed", err);
  }

  return { ok: true, printedAmount, inflationShockPp };
}
