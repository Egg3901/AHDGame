/**
 * Restructure resolution path — Phase 6.
 *
 * Country applies haircut + extended maturity to active sovereign bonds,
 * takes moderate trust hit + FX shock, locks bond markets for 16 turns, and
 * stores GDP penalty intent for Phase 8. Cascade write-downs are Phase 7.
 */

import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Bond } from "@/lib/db/types/bond";
import type { FederalBudget, SovereignCrisisState } from "@/lib/db/types/budget";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { deriveFiscalState, nationalDebtFromBalance } from "@/lib/budget/treasuryBalance";
import { applyCountryBondRestructure } from "../bondMutations/restructure";
import { applyCrossCountryTrustHit } from "../sideEffects/trustHit";
import { applyExchangeRateDepreciation } from "../sideEffects/fxDepreciation";
import { emitRestructuredNews } from "../crisisNews";
import { runCascade } from "../cascade/cascadeOrchestrator";
import { emitCascadeSummaryNews, emitMassCascadeAlert } from "../cascade/cascadeNews";
import { applyExecutivePoliticalImpact } from "../political/executivePoliticalImpact";
import { emitCivilUnrestEvents } from "../political/civilUnrestEvents";
import {
  RESTRUCTURE_HAIRCUT,
  RESTRUCTURE_MATURITY_EXTENSION_TURNS,
  RESTRUCTURE_TRUST_HIT,
  RESTRUCTURE_FX_DEPRECIATION,
  RESTRUCTURE_LOCKOUT_TURNS,
  RESTRUCTURE_GDP_PENALTY,
  RESTRUCTURE_GDP_PENALTY_TURNS,
} from "../constants";

export interface RestructureResolutionInput {
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

export interface RestructureResolutionResult {
  ok: boolean;
  reason?: "not-in-crisisPending" | "no-budget";
  bondsAffected?: number;
}

export async function applyRestructureResolution(
  db: Db,
  input: RestructureResolutionInput
): Promise<RestructureResolutionResult> {
  const { countryCode, currentTurn, realtimeMs, decisionId } = input;

  const budgetId = getNationalBudgetId(countryCode);
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  if (!budget) return { ok: false, reason: "no-budget" };

  const state: SovereignCrisisState = budget.sovereignCrisisState ?? "normal";
  if (state !== "crisisPending" && state !== "crisisResolving") {
    return { ok: false, reason: "not-in-crisisPending" };
  }

  const { bondsAffected } = await applyCountryBondRestructure(
    db,
    countryCode,
    RESTRUCTURE_HAIRCUT,
    RESTRUCTURE_MATURITY_EXTENSION_TURNS
  );
  await applyCrossCountryTrustHit(db, countryCode, RESTRUCTURE_TRUST_HIT);
  await applyExchangeRateDepreciation(db, countryCode, RESTRUCTURE_FX_DEPRECIATION);

  // Cascade: load the bonds we just restructured and write down their holders.
  // Restructure does not flip `defaulted: true`, so filter on the haircut field
  // we just stamped (the mutator stamps every bond with the same RESTRUCTURE_HAIRCUT).
  const justRestructuredBonds = await db
    .collection<Bond>("bonds")
    .find({
      issuerType: "sovereign",
      countryId: countryCode,
      defaulted: false,
      matured: false,
      restructureHaircutPercent: RESTRUCTURE_HAIRCUT,
    })
    .toArray();
  const cascadeResult = await runCascade(db, {
    initialBonds: justRestructuredBonds,
    reason: "restructure",
    currentTurn,
    countryCode,
  });

  // Genuine sovereign-ledger write-down (refs #3813): apply the SAME haircut
  // fraction dealt to bondholders to the federal budget's own debt ledger.
  // `treasuryBalance`/`debt.principal` — not the `bonds` collection — is what
  // `processTreasuryTurn`/`processAnnualDebt` read every turn to derive the
  // interest-rate tier and debt/GDP ratio; leaving it untouched means the very
  // next tick recomputes the identical pre-crisis tier and the spiral resumes.
  const priorPrincipal =
    budget.treasuryBalance != null
      ? nationalDebtFromBalance(budget.treasuryBalance)
      : (budget.debt?.principal ?? 0);
  const writtenDownTreasuryBalance = -(priorPrincipal * (1 - RESTRUCTURE_HAIRCUT));
  const derivedFiscal = deriveFiscalState({
    treasuryBalance: writtenDownTreasuryBalance,
    gdp: budget.gdp ?? 0,
    gdpSmoothed: budget.gdpSmoothed,
    ceiling: budget.debt?.ceiling ?? 0,
    investorConfidence: budget.investorConfidence,
    imfBailoutActive: budget.imfSovereignBailoutActive,
    sovereignRiskAnchor: budget.sovereignRiskAnchor,
  });

  const update: Partial<FederalBudget> = {
    crisisChoice: "restructure",
    crisisChoiceAt: { turn: currentTurn, realtimeMs },
    sovereignCrisisState: "recovering",
    recoveryStartedAt: { turn: currentTurn },
    lastDefaultTurn: currentTurn,
    recoveryFiscalDisciplineStreak: 0,
    marketAccessLockedUntilTurn: currentTurn + RESTRUCTURE_LOCKOUT_TURNS,
    recoveryGdpPenaltyPercent: RESTRUCTURE_GDP_PENALTY,
    recoveryGdpPenaltyTurnsRemaining: RESTRUCTURE_GDP_PENALTY_TURNS,
    creditRating: "B",
    crisisAutoActionAt: null,
    crisisLegislativeDeadlineAt: null,
    treasuryBalance: writtenDownTreasuryBalance,
    debt: {
      ...budget.debt,
      principal: derivedFiscal.principal,
      interestRate: derivedFiscal.interestRate,
    },
    debtToGdpRatio: derivedFiscal.debtToGdpRatio,
  };

  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne({ _id: budgetId }, { $set: update });

  if (!input.skipDecisionUpdate) {
    const decisionUpdate: Partial<SovereignCrisisDecision> = {
      state: "ratified",
      executiveChoice: "restructure",
      executiveProposedAtRealtimeMs: realtimeMs,
      resolvedAt: new Date(realtimeMs),
      resolvedReason: "Sovereign debt restructured (phase 6 auto-ratify)",
    };
    await db
      .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
      .updateOne({ _id: decisionId }, { $set: decisionUpdate });
  }

  await emitRestructuredNews(countryCode, currentTurn, RESTRUCTURE_HAIRCUT, bondsAffected);
  await emitCascadeSummaryNews(countryCode, cascadeResult);
  await emitMassCascadeAlert(db, countryCode, cascadeResult.totalCorpsInsolvent, currentTurn);

  // Phase 11b: executive personal political impact.
  const decision = await db
    .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
    .findOne({ _id: decisionId });
  await applyExecutivePoliticalImpact(db, decision?.proposingCharacterId ?? null, "restructure");

  // Phase 11b: civil-unrest event (1 for restructure path).
  try {
    await emitCivilUnrestEvents(db, countryCode, "restructure");
  } catch (err) {
    console.error("emitCivilUnrestEvents (restructure) failed", err);
  }

  return { ok: true, bondsAffected };
}
