/**
 * Repudiate resolution path — Phase 6.
 *
 * Country flips all active sovereign bonds to defaulted, takes large trust
 * hit, FX shocks, locks bond market access for 48 turns, and stores GDP
 * penalty intent for Phase 8. Cascade write-downs to bondholders are Phase 7.
 */

import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Bond } from "@/lib/db/types/bond";
import type { FederalBudget, SovereignCrisisState } from "@/lib/db/types/budget";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import {
  sumOutstandingSovereignPrincipal,
  sovereignDebtTerms,
} from "@/lib/bonds/sovereignPrincipal";
import { markCountryBondsRepudiated } from "../bondMutations/repudiate";
import { applyCrossCountryTrustHit } from "../sideEffects/trustHit";
import { applyExchangeRateDepreciation } from "../sideEffects/fxDepreciation";
import { emitRepudiatedNews } from "../crisisNews";
import { runCascade } from "../cascade/cascadeOrchestrator";
import { emitCascadeSummaryNews, emitMassCascadeAlert } from "../cascade/cascadeNews";
import { applyExecutivePoliticalImpact } from "../political/executivePoliticalImpact";
import { triggerSystemNoConfidence } from "../political/triggerSystemNoConfidence";
import { emitCivilUnrestEvents } from "../political/civilUnrestEvents";
import {
  REPUDIATE_TRUST_HIT,
  REPUDIATE_FX_DEPRECIATION,
  REPUDIATE_LOCKOUT_TURNS,
  REPUDIATE_GDP_PENALTY,
  REPUDIATE_GDP_PENALTY_TURNS,
} from "../constants";

export interface RepudiateResolutionInput {
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
   * on auto-Repudiate) and `executiveProposedAtRealtimeMs`.
   */
  skipDecisionUpdate?: boolean;
}

export interface RepudiateResolutionResult {
  ok: boolean;
  reason?: "not-in-crisisPending" | "no-budget";
  bondsAffected?: number;
}

export async function applyRepudiateResolution(
  db: Db,
  input: RepudiateResolutionInput
): Promise<RepudiateResolutionResult> {
  const { countryCode, currentTurn, realtimeMs, decisionId } = input;

  const budgetId = getNationalBudgetId(countryCode);
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  if (!budget) return { ok: false, reason: "no-budget" };

  const state: SovereignCrisisState = budget.sovereignCrisisState ?? "normal";
  if (state !== "crisisPending" && state !== "crisisResolving") {
    return { ok: false, reason: "not-in-crisisPending" };
  }

  const { bondsAffected } = await markCountryBondsRepudiated(db, countryCode, currentTurn);
  await applyCrossCountryTrustHit(db, countryCode, REPUDIATE_TRUST_HIT);
  await applyExchangeRateDepreciation(db, countryCode, REPUDIATE_FX_DEPRECIATION);

  // Cascade: load the bonds we just flipped and write down their holders.
  // Filter on `defaultedAtTurn: currentTurn` so we only see this batch, never
  // historic defaults from prior crises.
  const justDefaultedBonds = await db
    .collection<Bond>("bonds")
    .find({
      issuerType: "sovereign",
      countryId: countryCode,
      defaulted: true,
      defaultedAtTurn: currentTurn,
    })
    .toArray();
  const cascadeResult = await runCascade(db, {
    initialBonds: justDefaultedBonds,
    reason: "repudiate",
    currentTurn,
    countryCode,
  });

  // Flipping the bonds to defaulted IS the write-down (refs #1975): the
  // stored stock is re-pointed at the outstanding sum read back from the
  // ledger (zero once every active bond is defaulted). Treasury cash is a
  // separate position and stays untouched. Reading the ledger back keeps
  // this a pure function of bond state, so crash/retry replay converges.
  const postDefaultBonds = await db
    .collection<Bond>("bonds")
    .find(
      { issuerType: "sovereign", countryId: countryCode, matured: false, defaulted: false },
      // The outstanding helper re-checks the query-filtered fields, so they
      // must be projected: a doc arriving without `issuerType` reads as
      // non-sovereign and contributes 0, which would zero the stored stock.
      {
        projection: {
          issuerType: 1,
          matured: 1,
          defaulted: 1,
          totalIssued: 1,
          restructureHaircutPercent: 1,
        },
      }
    )
    .toArray();
  const writtenDownPrincipal = Math.round(sumOutstandingSovereignPrincipal(postDefaultBonds));
  const terms = sovereignDebtTerms(writtenDownPrincipal, {
    gdp: budget.gdp ?? 0,
    gdpSmoothed: budget.gdpSmoothed,
    investorConfidence: budget.investorConfidence,
    imfBailoutActive: budget.imfSovereignBailoutActive,
    sovereignRiskAnchor: budget.sovereignRiskAnchor,
  });

  const update: Partial<FederalBudget> = {
    crisisChoice: "repudiate",
    crisisChoiceAt: { turn: currentTurn, realtimeMs },
    sovereignCrisisState: "recovering",
    recoveryStartedAt: { turn: currentTurn },
    lastDefaultTurn: currentTurn,
    recoveryFiscalDisciplineStreak: 0,
    marketAccessLockedUntilTurn: currentTurn + REPUDIATE_LOCKOUT_TURNS,
    recoveryGdpPenaltyPercent: REPUDIATE_GDP_PENALTY,
    recoveryGdpPenaltyTurnsRemaining: REPUDIATE_GDP_PENALTY_TURNS,
    creditRating: "CCC",
    crisisAutoActionAt: null,
    crisisLegislativeDeadlineAt: null,
    debt: {
      ...budget.debt,
      principal: writtenDownPrincipal,
      interestRate: terms.interestRate,
    },
    debtToGdpRatio: terms.debtToGdpRatio,
  };

  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne({ _id: budgetId }, { $set: update });

  if (!input.skipDecisionUpdate) {
    const decisionUpdate: Partial<SovereignCrisisDecision> = {
      state: "ratified",
      executiveChoice: "repudiate",
      executiveProposedAtRealtimeMs: realtimeMs,
      resolvedAt: new Date(realtimeMs),
      resolvedReason: "Sovereign debt repudiated (phase 6 auto-ratify)",
    };
    await db
      .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
      .updateOne({ _id: decisionId }, { $set: decisionUpdate });
  }

  await emitRepudiatedNews(countryCode, currentTurn, bondsAffected);
  await emitCascadeSummaryNews(countryCode, cascadeResult);
  await emitMassCascadeAlert(db, countryCode, cascadeResult.totalCorpsInsolvent, currentTurn);

  // Phase 11b: executive personal political impact (Repudiate is the harshest).
  const decision = await db
    .collection<SovereignCrisisDecision>("sovereignCrisisDecisions")
    .findOne({ _id: decisionId });
  await applyExecutivePoliticalImpact(db, decision?.proposingCharacterId ?? null, "repudiate");

  // Phase 11b: parliamentary countries auto-trigger a no-confidence vote
  // against the sitting PM. Best-effort — failure shouldn't block the
  // recovery transition.
  try {
    await triggerSystemNoConfidence(db, countryCode, "Sovereign-debt repudiation", currentTurn);
  } catch (err) {
    console.error("triggerSystemNoConfidence (repudiate) failed", err);
  }

  // Phase 11b: civil-unrest events (3 for repudiate — most severe).
  try {
    await emitCivilUnrestEvents(db, countryCode, "repudiate");
  } catch (err) {
    console.error("emitCivilUnrestEvents (repudiate) failed", err);
  }

  return { ok: true, bondsAffected };
}
