import type { NppMarketEntryReason } from "@/lib/db/types/marketFormation";
import { firstRejectingGate } from "@/lib/corporations/capacityDecisionTelemetry/rules";

export const NPP_OPERATOR_TELEMETRY_SCHEMA_VERSION = 1 as const;

export type NppOperatorBindingGate =
  "passive" | "cash_floor" | "unprofitable" | NppMarketEntryReason;
export type NppOperatorBudgetBand = "distress" | "thin" | "healthy" | "strong";
export type NppDividendPolicy = "paying" | "withheld";

/**
 * Which of the four NPP operator decision legs a constraint belongs to. Ordered
 * as the brain evaluates them in `nppCorporationBehavior.ts`: divest (section
 * 1), growth-band/margin (section 2), budget (section 3), dividend (section 4).
 */
export type NppDecisionLeg = "divest" | "growth" | "budget" | "dividend";

/**
 * Finer binding-constraint vocabulary, one closed set that spans the four
 * decision legs.
 *
 * `NppOperatorBindingGate` names the COARSE gate — mostly the market-entry
 * reason, so almost every unexpanding corp reads `no_enterable_market`. That is
 * exactly the signal #2122 could not use: it cannot tell "the reinvest/divest
 * brain refused" from "there was nowhere to enter", and it never names the
 * divest, growth-band, budget, or dividend lever that actually bit. This
 * vocabulary names the internal lever instead, and, like the capacity-decision
 * outcomes, is a first-rejecting-gate funnel: at most one value is recorded per
 * corporation per turn, the earliest leg in
 * {@link NPP_DECISION_CONSTRAINT_PRECEDENCE} that fired.
 *
 * Aggregate-safe and privacy-safe by construction: the value is a bucket key, so
 * the persisted document holds a bounded number of keys and never a corporation,
 * NPP, player, or sector identifier.
 */
export type NppDecisionConstraint =
  // 1. Divest leg — a losing sector is shed, or a shed is blocked.
  | "divest_core_protected"
  | "divest_no_other_income"
  | "divested"
  // 2. Growth-band / margin leg — the growth governor backs the target off.
  | "growth_unaffordable"
  | "loss_margin"
  | "glut_signal"
  | "chronic_low_fill"
  // 3. Budget leg — discretionary spend is clamped to the distress/lean band.
  | "budget_cash_crisis"
  | "budget_unprofitable"
  | "budget_thin_margin"
  // 4. Dividend leg — shareholder returns are withheld.
  | "dividend_cash_floor"
  | "dividend_unprofitable"
  | "dividend_margin_below_min";

/**
 * First-rejecting-gate precedence, earliest first. Mirrors the section order in
 * `makeNppCorpDecision` (divest → growth → budget → dividend) and the branch
 * order WITHIN each leg, so the recorded constraint is always the first lever
 * that actually bound the decision. The shell MUST resolve through
 * {@link resolveNppDecisionConstraint}; the tests pin the order.
 */
export const NPP_DECISION_CONSTRAINT_PRECEDENCE = [
  // Divest leg: a blocked shed (protected core, or nothing else earning)
  // outranks a completed shed, because a corp stuck holding a bleeder is the
  // #2122 failure mode.
  "divest_core_protected",
  "divest_no_other_income",
  "divested",
  // Growth leg: mirrors section 2's branch order — the affordability guard is
  // evaluated before the margin-loss band, the macro glut signal, then the
  // chronic-low-fill override.
  "growth_unaffordable",
  "loss_margin",
  "glut_signal",
  "chronic_low_fill",
  // Budget leg: section 3 checks cash crisis, then profitability, then margin.
  "budget_cash_crisis",
  "budget_unprofitable",
  "budget_thin_margin",
  // Dividend leg: section 4 withholds on the cash floor, then profit, then the
  // minimum payout margin.
  "dividend_cash_floor",
  "dividend_unprofitable",
  "dividend_margin_below_min",
] as const satisfies readonly NppDecisionConstraint[];

/** The decision leg each constraint belongs to. Exhaustive over the vocabulary. */
export const NPP_DECISION_CONSTRAINT_LEG: Record<NppDecisionConstraint, NppDecisionLeg> = {
  divest_core_protected: "divest",
  divest_no_other_income: "divest",
  divested: "divest",
  growth_unaffordable: "growth",
  loss_margin: "growth",
  glut_signal: "growth",
  chronic_low_fill: "growth",
  budget_cash_crisis: "budget",
  budget_unprofitable: "budget",
  budget_thin_margin: "budget",
  dividend_cash_floor: "dividend",
  dividend_unprofitable: "dividend",
  dividend_margin_below_min: "dividend",
};

/**
 * First-rejecting gate selection across the four decision legs: the earliest
 * constraint in {@link NPP_DECISION_CONSTRAINT_PRECEDENCE} flagged true wins;
 * null (no leg bound — the corp reinvests) wins when none is true. Legs the
 * shell never evaluated are passed as false-or-absent, never as true.
 */
export function resolveNppDecisionConstraint(
  flags: Partial<Record<NppDecisionConstraint, boolean>>
): NppDecisionConstraint | null {
  return firstRejectingGate(NPP_DECISION_CONSTRAINT_PRECEDENCE, flags);
}

export interface NppOperatorObservation {
  bindingGate: NppOperatorBindingGate;
  /**
   * Finer per-leg constraint: the first of the four decision legs that bound
   * this turn. Null when no leg bound (the corp is free to reinvest).
   */
  bindingConstraint: NppDecisionConstraint | null;
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
  /**
   * Counts over {@link NppDecisionConstraint}. Corporations whose every leg is
   * unbound (constraint null) are uncounted here; derive them as
   * `corporationsObserved - sum(constraintCounts)`.
   */
  constraintCounts: Partial<Record<NppDecisionConstraint, number>>;
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
  /**
   * Which of the four decision legs bound this turn, as raw gates. The resolver
   * picks the first in precedence; omit (or pass the empty record) when no leg
   * bound.
   */
  constraintFlags?: Partial<Record<NppDecisionConstraint, boolean>>;
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
    bindingConstraint: resolveNppDecisionConstraint(args.constraintFlags ?? {}),
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
    constraintCounts: {},
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
    if (observation.bindingConstraint) {
      increment(result.constraintCounts, observation.bindingConstraint);
    }
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
