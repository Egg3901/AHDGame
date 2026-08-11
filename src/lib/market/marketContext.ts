import type { MarketSystemMode } from "@/lib/market/featureFlag";
import { marketAtLeast } from "@/lib/market/featureFlag";
import type { SectorClearingResult } from "@/lib/market/clearing";
import {
  MARKET_REALIZATION_DEVIATION_CAP,
  MARKET_REALIZATION_RAMP_TURNS,
} from "@/lib/market/capital";

/**
 * Per-turn market-rework context threaded into the corporation phase —
 * resolved once from `marketSystemMode` (mirrors LabourContext).
 */
export interface MarketContext {
  /** Tier 1: realized revenue scaled by lagged output prices. */
  realizationEnabled: boolean;
  /** Tier 3 / D1: output throttled by the scarcest available input. */
  throughputEnabled: boolean;
  /** Tier 3 / Fix 2: posted-price market clearing. */
  clearingEnabled: boolean;
  /** Tier 4 / Fix 4 v1: capacity gates output; growth builds capital; depreciation. */
  capitalEnabled: boolean;
  /**
   * Tier 5 ("plants", P2 of the buildable-sectors plan): capacity is the
   * AUTHORITATIVE production base and revenue is derived from produced units,
   * instead of capacity merely haircutting a compounding revenue nameplate.
   */
  plantsEnabled: boolean;
  /**
   * Pre-pass clearing results per sector id (computed in the corp-phase entry
   * from lagged balances). Absent entries mean "no outputs" → factor 1.
   */
  clearingBySectorId?: ReadonlyMap<string, SectorClearingResult>;
  /**
   * Launch-safety governor bounds (tunable live via gameConfig). `cap` is the
   * max fractional deviation the clearing/throughput legs may take from the
   * ledger baseline; `rampTurns` is the window over which that divergence fades
   * in from the flip. Fall back to the module defaults when unset.
   */
  governorCap: number;
  governorRampTurns: number;
}

/** Baseline economy — every market-rework mechanic off. */
export const MARKET_DISABLED: MarketContext = {
  realizationEnabled: false,
  throughputEnabled: false,
  clearingEnabled: false,
  capitalEnabled: false,
  plantsEnabled: false,
  governorCap: MARKET_REALIZATION_DEVIATION_CAP,
  governorRampTurns: MARKET_REALIZATION_RAMP_TURNS,
};

export function buildMarketContext(
  mode: MarketSystemMode,
  governor?: { cap?: number | null; rampTurns?: number | null }
): MarketContext {
  const cap =
    typeof governor?.cap === "number" && governor.cap >= 0 && governor.cap <= 1
      ? governor.cap
      : MARKET_REALIZATION_DEVIATION_CAP;
  const rampTurns =
    typeof governor?.rampTurns === "number" && governor.rampTurns >= 1
      ? governor.rampTurns
      : MARKET_REALIZATION_RAMP_TURNS;
  return {
    realizationEnabled: marketAtLeast(mode, "realization"),
    throughputEnabled: marketAtLeast(mode, "clearing"),
    clearingEnabled: marketAtLeast(mode, "clearing"),
    capitalEnabled: marketAtLeast(mode, "capital"),
    plantsEnabled: marketAtLeast(mode, "plants"),
    governorCap: cap,
    governorRampTurns: rampTurns,
  };
}
