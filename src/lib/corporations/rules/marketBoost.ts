/**
 * Phased stock-market boost: turn-ramped operating and valuation multipliers.
 *
 * Pure rules: turn number in, multiplier out. No database, no clock, no
 * randomness. The turn processor (sectorTurn, sectorCosts, banking valuation)
 * and the share-price call sites own loading state and passing `currentTurn`.
 *
 * Below STOCK_BOOST_REVENUE_START_TURN every helper returns its legacy value,
 * so worlds and unit tests on early turns are byte-identical.
 */
import {
  SECTOR_RISK_PREMIUM,
  STOCK_BOOST_BANK_NPV_TARGET,
  STOCK_BOOST_FINANCIAL_REVENUE_EXTRA,
  STOCK_BOOST_FINANCIAL_RISK_PREMIUM,
  STOCK_BOOST_NPV_RAMP_TURNS,
  STOCK_BOOST_NPV_START_TURN,
  STOCK_BOOST_REVENUE_RAMP_TURNS,
  STOCK_BOOST_REVENUE_START_TURN,
  STOCK_BOOST_REVENUE_TARGET,
  STOCK_BOOST_SECTOR_NPV_TARGET,
} from "@/lib/constants/corporations";

/**
 * Ramp progress 0 → 1 over `rampTurns` starting at `startTurn`.
 * Non-finite or pre-start turns return 0 (legacy, no boost).
 */
export function rampProgress(
  currentTurn: number | null | undefined,
  startTurn: number,
  rampTurns: number
): number {
  if (!Number.isFinite(currentTurn as number) || !Number.isFinite(startTurn)) return 0;
  if (!Number.isFinite(rampTurns) || rampTurns <= 0) {
    return (currentTurn as number) >= startTurn ? 1 : 0;
  }
  const turn = currentTurn as number;
  if (turn < startTurn) return 0;
  if (turn >= startTurn + rampTurns) return 1;
  return (turn - startTurn) / rampTurns;
}

/**
 * Linear ramp 1.0 → `target` over `rampTurns` starting at `startTurn`.
 * Non-finite or pre-start turns return 1.0 (legacy, no boost).
 */
export function rampMultiplier(
  currentTurn: number | null | undefined,
  startTurn: number,
  rampTurns: number,
  target: number
): number {
  return 1 + (target - 1) * rampProgress(currentTurn, startTurn, rampTurns);
}

/** Phase-A operating-revenue multiplier for one sector type. */
export function sectorRevenueBoostMultiplier(
  currentTurn: number | null | undefined,
  sectorType?: string | null
): number {
  const base = rampMultiplier(
    currentTurn,
    STOCK_BOOST_REVENUE_START_TURN,
    STOCK_BOOST_REVENUE_RAMP_TURNS,
    STOCK_BOOST_REVENUE_TARGET
  );
  if (sectorType !== "financial" || base <= 1) return base;
  const extra = rampMultiplier(
    currentTurn,
    STOCK_BOOST_REVENUE_START_TURN,
    STOCK_BOOST_REVENUE_RAMP_TURNS,
    STOCK_BOOST_FINANCIAL_REVENUE_EXTRA
  );
  return base * extra;
}

/** Phase-B sector-NPV multiplier. */
export function sectorNpvBoostMultiplier(currentTurn: number | null | undefined): number {
  return rampMultiplier(
    currentTurn,
    STOCK_BOOST_NPV_START_TURN,
    STOCK_BOOST_NPV_RAMP_TURNS,
    STOCK_BOOST_SECTOR_NPV_TARGET
  );
}

/** Phase-B bank-income NPV multiplier (chartered banks). */
export function bankNpvBoostMultiplier(currentTurn: number | null | undefined): number {
  return rampMultiplier(
    currentTurn,
    STOCK_BOOST_NPV_START_TURN,
    STOCK_BOOST_NPV_RAMP_TURNS,
    STOCK_BOOST_BANK_NPV_TARGET
  );
}

/**
 * Cost-of-capital risk premium for a corp type at a turn. Only the financial
 * premium moves (0.06 → boosted over the NPV window); every other type reads
 * the standing table at every turn.
 */
export function sectorRiskPremiumAtTurn(
  corpType: string | null | undefined,
  currentTurn: number | null | undefined
): number {
  const base = SECTOR_RISK_PREMIUM[corpType as string] ?? SECTOR_RISK_PREMIUM.default;
  if (corpType !== "financial") return base;
  const progress = rampProgress(
    currentTurn,
    STOCK_BOOST_NPV_START_TURN,
    STOCK_BOOST_NPV_RAMP_TURNS
  );
  return base + (STOCK_BOOST_FINANCIAL_RISK_PREMIUM - base) * progress;
}
