import type { NppMarketEntryReason } from "@/lib/db/types/marketFormation";

export const NPP_OPERATOR_TELEMETRY_SCHEMA_VERSION = 1 as const;

export type NppOperatorBindingGate =
  "passive" | "cash_floor" | "unprofitable" | NppMarketEntryReason;
export type NppOperatorBudgetBand = "distress" | "thin" | "healthy" | "strong";
export type NppDividendPolicy = "paying" | "withheld";

export interface NppOperatorObservation {
  bindingGate: NppOperatorBindingGate;
  budgetBand: NppOperatorBudgetBand;
  dividendPolicy: NppDividendPolicy;
  dividendRate: number;
  divestedSectors: number;
  reinvestments: number;
  marginPct: number;
  cashHeadroomAnchor: number;
}

export interface NppOperatorAggregate {
  corporationsObserved: number;
  bindingGateCounts: Partial<Record<NppOperatorBindingGate, number>>;
  budgetBandCounts: Partial<Record<NppOperatorBudgetBand, number>>;
  dividendPolicyCounts: Partial<Record<NppDividendPolicy, number>>;
  dividendRateSum: number;
  divestedSectors: number;
  reinvestments: number;
  marginPctSum: number;
  cashHeadroomAnchorSum: number;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function increment<K extends string>(counts: Partial<Record<K, number>>, key: K): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function buildNppOperatorObservation(args: {
  passive: boolean;
  profitable: boolean;
  marginPct: number;
  cashCrisis: boolean;
  entryReason?: NppMarketEntryReason;
  dividendRate: number;
  divestedSectors: number;
  reinvestments: number;
  cashHeadroomAnchor: number;
}): NppOperatorObservation {
  const budgetBand: NppOperatorBudgetBand =
    args.passive || args.cashCrisis || !args.profitable
      ? "distress"
      : args.marginPct < 10
        ? "thin"
        : args.marginPct < 25
          ? "healthy"
          : "strong";
  const bindingGate: NppOperatorBindingGate = args.passive
    ? "passive"
    : args.cashCrisis
      ? "cash_floor"
      : !args.profitable
        ? "unprofitable"
        : (args.entryReason ?? "no_enterable_market");
  const dividendRate = Math.max(0, finite(args.dividendRate));
  return {
    bindingGate,
    budgetBand,
    dividendPolicy: dividendRate > 0 ? "paying" : "withheld",
    dividendRate,
    divestedSectors: Math.max(0, finite(args.divestedSectors)),
    reinvestments: Math.max(0, finite(args.reinvestments)),
    marginPct: finite(args.marginPct),
    cashHeadroomAnchor: finite(args.cashHeadroomAnchor),
  };
}

export function aggregateNppOperatorObservations(
  observations: readonly NppOperatorObservation[]
): NppOperatorAggregate {
  const result: NppOperatorAggregate = {
    corporationsObserved: 0,
    bindingGateCounts: {},
    budgetBandCounts: {},
    dividendPolicyCounts: {},
    dividendRateSum: 0,
    divestedSectors: 0,
    reinvestments: 0,
    marginPctSum: 0,
    cashHeadroomAnchorSum: 0,
  };
  for (const observation of observations) {
    result.corporationsObserved++;
    increment(result.bindingGateCounts, observation.bindingGate);
    increment(result.budgetBandCounts, observation.budgetBand);
    increment(result.dividendPolicyCounts, observation.dividendPolicy);
    result.dividendRateSum += finite(observation.dividendRate);
    result.divestedSectors += finite(observation.divestedSectors);
    result.reinvestments += finite(observation.reinvestments);
    result.marginPctSum += finite(observation.marginPct);
    result.cashHeadroomAnchorSum += finite(observation.cashHeadroomAnchor);
  }
  return result;
}
