/**
 * Sovereign issuance diagnostics (#1001): issue-level subscription, holder
 * counts, spreads, maturity concentration, and the tranche-consolidation
 * planner.
 *
 * Pure rules module: plain data in, plain data out. No database, wall clock,
 * randomness, or environment reads, so the headless harness can copy it.
 *
 * Two uses:
 * - observability (always on): `summarizeSovereignIssue` and
 *   `summarizeSovereignIssuanceByCountry` report what the scheduler and the
 *   market produced. They change no behavior.
 * - consolidation (gated off): `consolidateSovereignTranches` merges dust
 *   tranches into the ladder. It only runs when the caller enables it; the
 *   scheduler keeps it behind `sovereignIssuanceConsolidationEnabled` until
 *   worldsim evidence lands.
 */

import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import type { Bond, BondMaturityTurns } from "@/lib/db/types";
import type { SovereignCountryIssuanceSnapshot } from "@/lib/db/types/economicVitalSigns";

/**
 * Provisional floor for a legible sovereign tranche, in whole units.
 * 1,000 units at 1,000 face is 1M face per tranche leg. Below this an issue
 * leg is a sliver that can never carry its own holder base: it adds to the
 * unheld-issue count without adding depth. Reporting-only until the gated
 * consolidation path is validated; do not retune without a sim report.
 */
export const SOVEREIGN_MIN_TRANCHE_UNITS = 1000;

/** The bond fields diagnostics read. `Bond` satisfies this structurally. */
export type SovereignDiagnosticBond = Pick<
  Bond,
  | "issuerType"
  | "countryId"
  | "maturityTurn"
  | "issuedAtTurn"
  | "couponRate"
  | "marketPrice"
  | "totalIssued"
  | "publicFloat"
  | "holders"
  | "primaryFillRatio"
  | "matured"
>;

/** One sovereign issue leg, as the market left it. */
export interface SovereignIssueSummary {
  countryId: string | null;
  maturityTurn: number;
  issuedAtTurn: number;
  couponRate: number;
  /** Whole units held across every holder row. */
  heldUnits: number;
  /** Whole units still sitting in public float. */
  floatUnits: number;
  /** Distinct holder rows with a positive unit balance. */
  holderCount: number;
  /** held / (held + float); 0 when nothing is outstanding on either side. */
  subscriptionRate: number;
  /** Discount to par in percentage points; positive means below par. */
  spreadToParPct: number;
  /** Placed / requested at issuance, when the primary market stamped it. */
  primaryFillRatio: number | null;
  /** Face outstanding. */
  totalIssued: number;
  /** True when the leg is smaller than the provisional tranche floor. */
  thinIssue: boolean;
}

function nonnegative(value: number | undefined | null): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Herfindahl index on a 0-10,000 scale; 0 when there is nothing to split. */
function hhi(values: number[]): number {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return 0;
  return (
    values.reduce((sum, value) => {
      const share = Math.max(0, value) / total;
      return sum + share * share;
    }, 0) * 10_000
  );
}

export function summarizeSovereignIssue(bond: SovereignDiagnosticBond): SovereignIssueSummary {
  const heldUnits = (bond.holders ?? []).reduce(
    (sum, holder) => sum + nonnegative(holder.units),
    0
  );
  const floatUnits = Math.floor(nonnegative(bond.publicFloat));
  const holderCount = (bond.holders ?? []).filter((holder) => nonnegative(holder.units) > 0).length;
  const outstanding = heldUnits + floatUnits;
  const marketPrice = Number.isFinite(bond.marketPrice) ? bond.marketPrice : 1;
  const totalUnits = Math.floor(nonnegative(bond.totalIssued) / BOND_UNIT_FACE_VALUE);
  return {
    countryId: bond.countryId ?? null,
    maturityTurn: bond.maturityTurn,
    issuedAtTurn: bond.issuedAtTurn,
    couponRate: bond.couponRate,
    heldUnits,
    floatUnits,
    holderCount,
    subscriptionRate: outstanding > 0 ? heldUnits / outstanding : 0,
    spreadToParPct: (1 - marketPrice) * 100,
    primaryFillRatio:
      typeof bond.primaryFillRatio === "number" && Number.isFinite(bond.primaryFillRatio)
        ? bond.primaryFillRatio
        : null,
    totalIssued: nonnegative(bond.totalIssued),
    thinIssue: totalUnits < SOVEREIGN_MIN_TRANCHE_UNITS,
  };
}

function isLiveSovereign(bond: SovereignDiagnosticBond): boolean {
  return bond.issuerType === "sovereign" && bond.matured !== true;
}

/**
 * Per-country rollup over live sovereign issues: the issue-level rows above,
 * grouped so a country-local allocator gap (countries without domestic funds
 * retaining unheld paper) shows up as a cross-section instead of a world
 * average. Order is by country id for determinism.
 */
export function summarizeSovereignIssuanceByCountry(
  bonds: readonly SovereignDiagnosticBond[]
): SovereignCountryIssuanceSnapshot[] {
  const byCountry = new Map<string, SovereignIssueSummary[]>();
  for (const bond of bonds) {
    if (!isLiveSovereign(bond)) continue;
    const summary = summarizeSovereignIssue(bond);
    const key = summary.countryId ?? "unknown";
    const rows = byCountry.get(key);
    if (rows) rows.push(summary);
    else byCountry.set(key, [summary]);
  }
  return [...byCountry.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([countryId, rows]) => {
      const heldUnits = rows.reduce((sum, row) => sum + row.heldUnits, 0);
      const floatUnits = rows.reduce((sum, row) => sum + row.floatUnits, 0);
      const outstanding = heldUnits + floatUnits;
      const faceByMaturity = new Map<number, number>();
      for (const row of rows) {
        faceByMaturity.set(
          row.maturityTurn,
          (faceByMaturity.get(row.maturityTurn) ?? 0) + row.totalIssued
        );
      }
      return {
        countryId,
        issueCount: rows.length,
        unheldIssueCount: rows.filter((row) => row.holderCount === 0).length,
        noHolderShare:
          rows.length > 0 ? rows.filter((row) => row.holderCount === 0).length / rows.length : 0,
        subscriptionRate: outstanding > 0 ? heldUnits / outstanding : 0,
        medianHolders: median(rows.map((row) => row.holderCount)),
        medianSpreadToParPct: median(rows.map((row) => row.spreadToParPct)),
        maturityHhi: hhi([...faceByMaturity.values()]),
        thinIssueCount: rows.filter((row) => row.thinIssue).length,
      };
    });
}

/** One rung of the quarterly maturity ladder, before pool underwriting. */
export interface SovereignTranchePlan {
  maturityTurns: BondMaturityTurns;
  /** Whole-face amount for the rung. */
  amount: number;
}

/**
 * Split a quarterly issue amount across the maturity ladder exactly the way
 * the scheduler does: whole-face floor per rung, rungs below one face unit
 * skipped. Ascending maturity order matches `Object.entries` on integer-like
 * distribution keys.
 */
export function planSovereignTranches(
  distribution: Partial<Record<BondMaturityTurns, number>>,
  issueAmount: number
): SovereignTranchePlan[] {
  const tranches: SovereignTranchePlan[] = [];
  for (const [maturityStr, fraction] of Object.entries(distribution)) {
    if (!fraction || fraction <= 0) continue;
    const maturityTurns = Number(maturityStr) as BondMaturityTurns;
    const trancheAmount =
      Math.floor((issueAmount * fraction) / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE;
    if (trancheAmount < BOND_UNIT_FACE_VALUE) continue;
    tranches.push({ maturityTurns, amount: trancheAmount });
  }
  return tranches;
}

/**
 * Fold below-floor rungs into the largest rung (ties break to the longest
 * maturity, keeping duration on the ladder). Exact face preservation: amounts
 * only move between rungs, so the budget adjustment downstream is unchanged.
 * A non-positive floor returns the input untouched.
 */
export function consolidateSovereignTranches(
  tranches: readonly SovereignTranchePlan[],
  minUnits: number
): SovereignTranchePlan[] {
  const floor = Number.isFinite(minUnits) ? Math.floor(minUnits) : 0;
  if (floor <= 0 || tranches.length <= 1) return [...tranches];
  const minFace = floor * BOND_UNIT_FACE_VALUE;
  if (tranches.every((tranche) => tranche.amount >= minFace)) return [...tranches];

  let anchorIndex = 0;
  for (let index = 1; index < tranches.length; index++) {
    const candidate = tranches[index]!;
    const anchor = tranches[anchorIndex]!;
    if (
      candidate.amount > anchor.amount ||
      (candidate.amount === anchor.amount && candidate.maturityTurns > anchor.maturityTurns)
    ) {
      anchorIndex = index;
    }
  }
  const anchor = tranches[anchorIndex]!;
  const merged = tranches.reduce(
    (sum, tranche, index) => (index === anchorIndex ? sum : sum + tranche.amount),
    anchor.amount
  );
  return [{ maturityTurns: anchor.maturityTurns, amount: merged }];
}
