import { substepMarker } from "@/lib/observability/phaseSubsteps";
import type { CurrencyCode } from "@/lib/constants/currencies";

export interface CorporationTurnResult {
  corporationsProcessed: number;
  sectorsProcessed: number;
  totalRevenueGenerated: number;
  totalIncomeGenerated: number;
  /**
   * Deterministic `"<phase>: <detail>"` warning strings for this turn (issue
   * #2054: clearing book invariant breaches). The phase registry appends each
   * exactly once to the turn warning channel, which the completed-turn health
   * snapshot counts. Empty on clean turns.
   */
  turnWarnings: string[];
  /** CEO salary + shareholder dividends this turn, internal units (for LOC cap / scoring). */
  currencyIncomeInternalByCharacterId: Map<string, number>;
  /** Same income as credited to personal, per currency (for LOC repayment allocation). */
  currencyIncomeFaceByCharacterId: Map<string, Map<CurrencyCode, number>>;
}

/**
 * Sub-step timer. Always feeds the persisted phase sub-steps (#2689);
 * `SIM_CORP_TIMING=1` additionally prints the timings for simulation profiling.
 */
export function createCorporationTurnTimer() {
  const enabled = process.env.SIM_CORP_TIMING === "1";
  const timings: Array<[string, number]> = [];
  let previous = enabled ? Date.now() : 0;
  const steps = substepMarker();

  return {
    mark(label: string): void {
      steps.mark(label);
      if (!enabled) return;
      const now = Date.now();
      timings.push([label, now - previous]);
      previous = now;
    },
    finish(turn?: number): void {
      if (!enabled) return;
      const total = timings.reduce((sum, [, milliseconds]) => sum + milliseconds, 0);
      console.log(`[corp-timing] turn=${turn ?? "?"} total=${total}ms ${JSON.stringify(timings)}`);
    },
  };
}
