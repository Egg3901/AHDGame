/**
 * NPC executive auto-propose at crisis-fire.
 *
 * Per design Section 6.1: NPC executives don't wait the 12-hour player window.
 * Immediately at crisis-fire we run the scoring algorithm and transition the
 * decision to `executiveProposed` with the lower-chamber legislative phase
 * already opened — same shape the human /sovereign-resolution route produces.
 *
 * Skips when the country's executive is held by a player Character (they
 * decide via the UI). For NPP-controlled or vacant executives, auto-propose.
 */

import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { loadCountrySovereignSnapshot } from "../snapshotLoader";
import { buildInitialLegislativePhases } from "../legislative/buildPhases";
import { MONETIZE_GATE_INFLATION } from "../constants";
import { chooseResolution } from "./chooseResolution";
import { getExecutiveLeaderProfile } from "./getExecutiveLeaderProfile";
import type { NpcCountryState } from "./types";

const RESERVE_CURRENCY_CODES = new Set(["USD", "EUR", "JPY", "GBP", "CHF"]);

export interface NpcExecutiveAutoProposeInput {
  countryCode: CountryId;
  decisionId: ObjectId;
  currentTurn: number;
  realtimeMs: number;
}

export interface NpcExecutiveAutoProposeResult {
  ok: boolean;
  reason?: "player-controlled" | "no-budget" | "no-snapshot" | "decision-not-open";
  choice?: "bailout" | "restructure" | "monetize" | "repudiate";
}

export async function npcExecutiveAutoPropose(
  db: Db,
  input: NpcExecutiveAutoProposeInput
): Promise<NpcExecutiveAutoProposeResult> {
  const { countryCode, decisionId, realtimeMs } = input;

  const profile = await getExecutiveLeaderProfile(db, countryCode);
  if (profile.kind === "player") {
    return { ok: false, reason: "player-controlled" };
  }

  const budgetId = getNationalBudgetId(countryCode);
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  if (!budget) return { ok: false, reason: "no-budget" };

  const snapshot = await loadCountrySovereignSnapshot(db, countryCode, input.currentTurn);
  if (!snapshot) return { ok: false, reason: "no-snapshot" };

  // Compose NpcCountryState from budget + snapshot. inflationRatePct is in
  // percent (3.94 = 3.94%). Inflation gate uses the same MONETIZE_GATE_INFLATION
  // (0.08 fraction) the orchestrator uses, so behavior matches.
  const inflationRatePct = budget.economicFactors?.inflationRate ?? 0;
  const inflationGateExceeded = inflationRatePct / 100 > MONETIZE_GATE_INFLATION;
  const state: NpcCountryState = {
    debtToGdp: snapshot.debtToGdp,
    inflationRatePct,
    fxDepreciationFraction: snapshot.fxDepreciationRate10t ?? 0,
    hasReserveCurrency: RESERVE_CURRENCY_CODES.has(budget.currencyCode ?? ""),
    turnsSinceLastDefault: snapshot.turnsSinceLastDefault,
    inflationGateExceeded,
  };

  const choice = chooseResolution(state, profile);

  // Open lower-chamber legislative ratification on the decision row, and
  // transition the budget into "crisisResolving". Constrain on state="open"
  // so a parallel evaluation (next turn) can't double-fire.
  const phases = buildInitialLegislativePhases(countryCode, realtimeMs, input.currentTurn);
  const result = await db.collection<SovereignCrisisDecision>("sovereignCrisisDecisions").updateOne(
    { _id: decisionId, state: "open" },
    {
      $set: {
        state: "executiveProposed",
        executiveChoice: choice,
        executiveProposedAtRealtimeMs: realtimeMs,
        legislativePhases: phases,
        currentChamberIndex: 0,
      },
    }
  );
  if (result.modifiedCount === 0) {
    return { ok: false, reason: "decision-not-open" };
  }

  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne({ _id: budgetId }, { $set: { sovereignCrisisState: "crisisResolving" } });

  return { ok: true, choice };
}
