import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { isCommandEconomy } from "@/lib/constants/commandEconomy";
import { getEraMonetaryBaseline } from "@/lib/constants/monetaryEra";
import { getInflationTarget } from "@/lib/budget/inflation";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import {
  NPP_CHAIR_INFLATION_COEF,
  NPP_CHAIR_GROWTH_COEF,
  NPP_CHAIR_STEP_FRACTION,
  NPP_CHAIR_TARGET_GROWTH,
  MAX_RATE_CHANGE_DELTA,
  MAX_RATE_CUT_DELTA,
  RATE_CHANGE_COOLDOWN_TURNS,
  snapToPrimeRateGrid,
} from "@/lib/db/types/centralBank";
import { chairAlignmentPolicy, type ChairAlignment } from "@/lib/centralBank/chairAlignment";
import { isBankGovernmentControlled } from "@/lib/centralBank/governance";

/**
 * Taylor-rule target rate for the autonomous chair:
 * neutral + alpha*(inflation - target) + beta*(growth - 2.0).
 *
 * `alignment` (hawk/dove) tilts the weights and the inflation target; omitted ⇒
 * neutral (legacy behavior unchanged).
 */
export function computeNppChairRateTarget(params: {
  neutralRate: number;
  inflationRate: number;
  targetInflation: number;
  gdpGrowth: number;
  alignment?: ChairAlignment | null;
}): number {
  const policy = chairAlignmentPolicy(params.alignment);
  const effectiveTargetInflation = params.targetInflation + policy.targetInflationDelta;
  return (
    params.neutralRate +
    NPP_CHAIR_INFLATION_COEF *
      policy.inflationCoefMult *
      (params.inflationRate - effectiveTargetInflation) +
    NPP_CHAIR_GROWTH_COEF * policy.growthCoefMult * (params.gdpGrowth - NPP_CHAIR_TARGET_GROWTH)
  );
}

/**
 * Bounded step toward the target: 0.5x the gap, clamped to [-1.75, +0.75].
 * `alignment` scales hike vs. cut speed before the clamp (hawk hikes faster /
 * cuts slower; dove the inverse).
 */
export function computeNppChairRateStep(params: {
  currentRate: number;
  targetRate: number;
  alignment?: ChairAlignment | null;
}): number {
  const policy = chairAlignmentPolicy(params.alignment);
  const desired = params.targetRate - params.currentRate;
  let step = NPP_CHAIR_STEP_FRACTION * desired;
  step *= step >= 0 ? policy.hikeStepMult : policy.cutStepMult;
  return Math.max(-MAX_RATE_CUT_DELTA, Math.min(MAX_RATE_CHANGE_DELTA, step));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Per-turn autonomous rate setting for chairMode === "npp" banks. Reads the same
 * inflation/gdp sources as computeScrutinyDelta (federalBudget.economicFactors.inflationRate
 * and stateMetrics.economic.gdpGrowth.value, keyed by getNationalBudgetId / getNationalDocId),
 * computes a Taylor-rule target, and moves primeRate toward it by a bounded step, respecting
 * the existing 6-turn cooldown and lastRateChangeTurn tracking. No-op when within cooldown,
 * when the step is ~0, when the bank's rate belongs to the government, or when the bank is
 * not governed by an NPP technocrat chair.
 *
 * No chairInfamy character debit — the NPP has no character to penalize.
 */
export async function processNppChairAutoRate(
  db: Db,
  bank: Pick<
    CentralBank,
    | "_id"
    | "chairMode"
    | "primeRate"
    | "lastRateChangeTurn"
    | "chairAlignment"
    | "governmentControlled"
  >,
  countryId: CountryId,
  currentTurn: number,
  /**
   * CURRENT in-game year (gameState.currentYear) — resolves era-authored CB
   * anchors, graduating as the world's clock advances. Absent → modern
   * anchors (fail-safe).
   */
  currentYear?: number | null,
  /** GameConfig.commandEconomyEnabled — default OFF / fail-safe when omitted. */
  commandEconomyEnabled?: boolean,
  /**
   * Era START year (gameState.startingYear) — resolves whether the government,
   * not the bank, holds the rate. This is the START year, not `currentYear`:
   * see `isBankGovernmentControlled`, where a transfer of monetary power is a
   * statute the calendar must never pass on the players' behalf.
   */
  startingYear?: number
): Promise<void> {
  if (bank.chairMode !== "npp") return;
  // A government-controlled bank (the pre-1997 Bank of England) has no rate of
  // its own to set: the head of government or the finance minister sets it, and
  // the technocrat chair is a forecaster, not an authority. Without this the
  // autonomous chair moved the rate anyway and stamped `lastRateChangeTurn`,
  // and because the government shares that one cooldown field the Treasury's
  // window slammed shut every time it opened — the rate card sat permanently on
  // "on cooldown" and the government could never actually set the rate (#1250).
  // `fomcMeetingTurn` and `seedFomcBoards` already make the same check.
  if (isBankGovernmentControlled(bank, countryId, startingYear)) return;
  if (isCommandEconomy(countryId, currentYear, commandEconomyEnabled)) return;

  const lastChange = bank.lastRateChangeTurn;
  if (typeof lastChange === "number" && currentTurn - lastChange < RATE_CHANGE_COOLDOWN_TURNS) {
    return;
  }

  const targetInflation = getInflationTarget(countryId, currentYear);

  const budgetId = getNationalBudgetId(countryId);
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  const inflationRate = finiteOr(budget?.economicFactors?.inflationRate, targetInflation);

  const nationalDocId = getNationalDocId(countryId);
  const nationalMetrics = nationalDocId
    ? // SP5: national economic rollup lives on macroMetrics.
      await db.collection<StateMetrics>("macroMetrics").findOne({ _id: nationalDocId })
    : null;
  const gdpGrowth = finiteOr(nationalMetrics?.economic?.gdpGrowth?.value, NPP_CHAIR_TARGET_GROWTH);

  // Era-authored neutral rate when the current in-game era overrides it (e.g.
  // IT 1953 ≈ 4% vs the late-1970s 12% baked into defaultPrimeRate); otherwise
  // the country's modern default — unchanged for worlds at 1999+.
  const neutralRate =
    getEraMonetaryBaseline(countryId, currentYear)?.neutralPrimeRate ??
    COUNTRY_CONFIGS[countryId].centralBank.defaultPrimeRate;
  const targetRate = computeNppChairRateTarget({
    neutralRate,
    inflationRate,
    targetInflation,
    gdpGrowth,
    alignment: bank.chairAlignment,
  });
  const step = computeNppChairRateStep({
    currentRate: bank.primeRate,
    targetRate,
    alignment: bank.chairAlignment,
  });
  if (Math.abs(step) <= 1e-9) return;

  // Snap onto the quarter-point grid the rate API enforces. The Taylor rule
  // produces a continuous value, and storing it raw left the bank on a rate no
  // human chair could ever step away from: the card offers base +/-0.25, which
  // from an off-grid base is still off-grid, so every submission was refused
  // with "Rate must be in 0.25% increments" (ticket #1238).
  const newRate = snapToPrimeRateGrid(bank.primeRate + step);
  // Snapping can land back on the current rate for a sub-quarter-point step;
  // writing that would burn the cooldown on a no-op move.
  if (newRate === bank.primeRate) return;
  await db.collection<CentralBank>("centralBanks").updateOne(
    { _id: bank._id },
    {
      $set: {
        primeRate: newRate,
        lastRateChangeTurn: currentTurn,
        updatedAt: new Date(),
      },
    }
  );
}
