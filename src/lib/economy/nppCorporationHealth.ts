/**
 * NPP corporation health — the regression metric for GitHub issue #2122
 * ("Investigate why NPP-run corporations underperform").
 *
 * The issue's evidence says the failure is NOT uniform: NPP-led corps dominate
 * the rent sectors (logistics/technology/telecom) and bleed out in the thin
 * ones (retail 54% cash-negative, chemical_industries 48%, while
 * construction/energy/defense stay positive). The hypothesis is the
 * reinvest/divest brain, not general incompetence. This module is the
 * worldsim-measurable half of that: the per-sector CASH-NEGATIVE SHARE for
 * NPP-led corporations, plus the aggregate binding-gate/binding-constraint
 * counts that name WHICH gate bound.
 *
 * Pure: plain data in, plain data out. No db, no clock, no randomness, no
 * environment. The caller (an admin route) loads the corporations, restates
 * each `liquidCapital` to ₳ anchor units, passes the NPP CEO id set, and hands
 * over the persisted operator diagnostics. Empty input yields nulls, never
 * fabricated zeros.
 */

import type { CorporationType } from "@/lib/constants/corporations";
import type {
  NppDecisionConstraint,
  NppDecisionLeg,
  NppOperatorAggregate,
  NppOperatorBindingGate,
} from "@/lib/corporations/nppOperatorTelemetry/rules";
import { NPP_DECISION_CONSTRAINT_LEG } from "@/lib/corporations/nppOperatorTelemetry/rules";

/**
 * The corporation fields this metric reads. Deliberately plain data so the
 * module stays portable and testable without a database.
 */
export interface NppCorporationHealthCorporation {
  /** CEO holder id — the NPP-led join key (stringified ObjectId). */
  ceoId: string;
  /**
   * Known CEO cohort when the caller already filtered to it. A corp is NPP-led
   * when this is `"npp"` OR its `ceoId` is in the supplied NPP id set, so the
   * caller can classify either way.
   */
  ceoType?: "character" | "imperial" | "npp" | null;
  /** Primary sector — this corp's row in the per-sector metric. */
  type: CorporationType;
  /**
   * Cash on hand, already restated to ₳ anchor units by the caller (see
   * `corpLiquidCapitalToAnchor`). Cash-negative means `< 0`.
   */
  liquidCapital: number;
  /** Set on state-owned enterprises (state-backed, not private NPP capital). */
  countryOwnerId?: string | null;
  /** Present when the corp holds a private banking charter. */
  bankCharter?: { status?: string } | null;
}

export interface NppCorporationHealthSectorRow {
  sectorType: CorporationType;
  /** NPP-led corporations whose primary sector is this one. */
  nppLed: number;
  /** Of those, how many hold negative liquid capital. */
  cashNegative: number;
  /** `cashNegative / nppLed`; null when the sector has no NPP-led corps. */
  cashNegativeShare: number | null;
  /** Median liquid capital of the cohort, in ₳ anchor units; null when empty. */
  medianLiquidCapitalAnchor: number | null;
  /** Context partitions within the cohort. */
  stateOwned: number;
  bankChartered: number;
}

export interface NppCorporationHealthTotals {
  nppLed: number;
  cashNegative: number;
  cashNegativeShare: number | null;
  medianLiquidCapitalAnchor: number | null;
}

export interface NppCorporationHealthReport {
  /** Per-sector rows, sorted by sectorType for a deterministic report. */
  sectors: NppCorporationHealthSectorRow[];
  totals: NppCorporationHealthTotals;
  /** Coarse market-entry-derived gates from the persisted operator diagnostics. */
  bindingGateCounts: Partial<Record<NppOperatorBindingGate, number>>;
  /** Finer per-leg constraints from the persisted operator diagnostics. */
  bindingConstraintCounts: Partial<Record<NppDecisionConstraint, number>>;
  /** The same constraint counts rolled up to the four decision legs. */
  bindingConstraintLegCounts: Partial<Record<NppDecisionLeg, number>>;
  /** Corporations the diagnostics summarised this turn. */
  operatorObservations: number;
}

/** A corp is NPP-led when the caller says so by cohort or by id membership. */
function isNppLed(corp: NppCorporationHealthCorporation, nppCeoIds: ReadonlySet<string>): boolean {
  return corp.ceoType === "npp" || nppCeoIds.has(corp.ceoId);
}

/** Deterministic median of an ascending-sorted copy; null for an empty list. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function share(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function computeNppCorporationHealth(args: {
  corporations: readonly NppCorporationHealthCorporation[];
  /** NPP ids from the `npps` collection; optional when `ceoType` is supplied. */
  nppCeoIds?: ReadonlySet<string>;
  /** This turn's persisted `nppOperatorDiagnostics` aggregate, if any. */
  operatorDiagnostics?: NppOperatorAggregate | null;
}): NppCorporationHealthReport {
  const nppCeoIds = args.nppCeoIds ?? new Set<string>();
  const bySector = new Map<
    CorporationType,
    { cash: number[]; cashNegative: number; stateOwned: number; bankChartered: number }
  >();
  const allCash: number[] = [];
  let totalNppLed = 0;
  let totalCashNegative = 0;

  for (const corp of args.corporations) {
    if (!isNppLed(corp, nppCeoIds)) continue;
    const cash = finiteOrZero(corp.liquidCapital);
    const negative = cash < 0;
    totalNppLed += 1;
    if (negative) totalCashNegative += 1;
    allCash.push(cash);

    const group = bySector.get(corp.type) ?? {
      cash: [],
      cashNegative: 0,
      stateOwned: 0,
      bankChartered: 0,
    };
    group.cash.push(cash);
    if (negative) group.cashNegative += 1;
    if (corp.countryOwnerId) group.stateOwned += 1;
    if (corp.bankCharter) group.bankChartered += 1;
    bySector.set(corp.type, group);
  }

  const sectors: NppCorporationHealthSectorRow[] = [...bySector.entries()]
    .map(([sectorType, group]) => ({
      sectorType,
      nppLed: group.cash.length,
      cashNegative: group.cashNegative,
      cashNegativeShare: share(group.cashNegative, group.cash.length),
      medianLiquidCapitalAnchor: median(group.cash),
      stateOwned: group.stateOwned,
      bankChartered: group.bankChartered,
    }))
    .sort((a, b) => (a.sectorType < b.sectorType ? -1 : a.sectorType > b.sectorType ? 1 : 0));

  const diagnostics = args.operatorDiagnostics ?? null;
  const bindingConstraintCounts = diagnostics?.constraintCounts ?? {};
  const bindingConstraintLegCounts: Partial<Record<NppDecisionLeg, number>> = {};
  for (const [constraint, count] of Object.entries(bindingConstraintCounts)) {
    if (typeof count !== "number") continue;
    const leg = NPP_DECISION_CONSTRAINT_LEG[constraint as NppDecisionConstraint];
    bindingConstraintLegCounts[leg] = (bindingConstraintLegCounts[leg] ?? 0) + count;
  }

  return {
    sectors,
    totals: {
      nppLed: totalNppLed,
      cashNegative: totalCashNegative,
      cashNegativeShare: share(totalCashNegative, totalNppLed),
      medianLiquidCapitalAnchor: median(allCash),
    },
    bindingGateCounts: diagnostics?.bindingGateCounts ?? {},
    bindingConstraintCounts,
    bindingConstraintLegCounts,
    operatorObservations: diagnostics?.corporationsObserved ?? 0,
  };
}
