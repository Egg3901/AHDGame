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
import type { BondFundUniverse } from "@/lib/indexFunds/fundDefinitions";
import type { CreditRating } from "@/lib/db/types/centralBank";
import { CREDIT_RATINGS } from "@/lib/db/types/centralBank";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { SOVEREIGN_BOND_HOLDER_CAP } from "@/lib/bonds/holderCap";

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
  | "currencyCode"
  | "faceValue"
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
 *
 * When `demandGap` is provided, every unheld issue is classified with its
 * single primary demand-gap reason and the per-country counts ride along on
 * the row as `demandGapByReason` (summing to `unheldIssueCount`). Omitting it
 * leaves the field absent, so older callers and snapshots read identically.
 */
export function summarizeSovereignIssuanceByCountry(
  bonds: readonly SovereignDiagnosticBond[],
  demandGap?: (
    issue: SovereignDiagnosticBond,
    summary: SovereignIssueSummary
  ) => SovereignDemandGapReason
): SovereignCountryIssuanceSnapshot[] {
  const byCountry = new Map<
    string,
    { bond: SovereignDiagnosticBond; summary: SovereignIssueSummary }[]
  >();
  for (const bond of bonds) {
    if (!isLiveSovereign(bond)) continue;
    const summary = summarizeSovereignIssue(bond);
    const key = summary.countryId ?? "unknown";
    const rows = byCountry.get(key);
    const row = { bond, summary };
    if (rows) rows.push(row);
    else byCountry.set(key, [row]);
  }
  return [...byCountry.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([countryId, rows]) => {
      const summaries = rows.map((row) => row.summary);
      const heldUnits = summaries.reduce((sum, row) => sum + row.heldUnits, 0);
      const floatUnits = summaries.reduce((sum, row) => sum + row.floatUnits, 0);
      const outstanding = heldUnits + floatUnits;
      const faceByMaturity = new Map<number, number>();
      for (const row of summaries) {
        faceByMaturity.set(
          row.maturityTurn,
          (faceByMaturity.get(row.maturityTurn) ?? 0) + row.totalIssued
        );
      }
      const snapshot: SovereignCountryIssuanceSnapshot = {
        countryId,
        issueCount: rows.length,
        unheldIssueCount: summaries.filter((row) => row.holderCount === 0).length,
        noHolderShare:
          rows.length > 0
            ? summaries.filter((row) => row.holderCount === 0).length / rows.length
            : 0,
        subscriptionRate: outstanding > 0 ? heldUnits / outstanding : 0,
        medianHolders: median(summaries.map((row) => row.holderCount)),
        medianSpreadToParPct: median(summaries.map((row) => row.spreadToParPct)),
        maturityHhi: hhi([...faceByMaturity.values()]),
        thinIssueCount: summaries.filter((row) => row.thinIssue).length,
      };
      if (demandGap) {
        const byReason: Partial<Record<SovereignDemandGapReason, number>> = {};
        for (const { bond, summary } of rows) {
          if (summary.holderCount !== 0) continue;
          const reason = demandGap(bond, summary);
          byReason[reason] = (byReason[reason] ?? 0) + 1;
        }
        snapshot.demandGapByReason = byReason;
      }
      return snapshot;
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

/**
 * Why an unheld sovereign issue has no fund holder (#1001 demand channel).
 * Exactly one reason is assigned per issue, in allocator order: the first
 * gate that excludes the issue from every fund that could otherwise buy it.
 * The order mirrors `deployBondReserveFromCash` / `loadBondFundCandidates`:
 * availability, then mandate (domestic coverage, cross-border scope, currency
 * convertibility, rating universe), then per-fund limits (holder cap, cash
 * buffer and reserve target). Anything left over is transient demand, not a
 * structural gate: the mandate, cash, cap, and float all allow a purchase
 * that simply has not happened yet (timing, breadth caps, queued redemptions
 * skipping the deploy pass).
 */
export type SovereignDemandGapReason =
  | "no_float"
  | "no_domestic_fund"
  | "cross_border_disabled"
  | "capital_controls"
  | "currency_mismatch"
  | "ineligible"
  | "position_limit"
  | "cash_buffer"
  | "reserve_target_met"
  | "awaiting_demand";

/** One fund as the demand-gap classifier sees it. All numbers are anchor. */
export interface SovereignDemandGapFund {
  /** Stable key for per-issue holder-cap accounting (the fund slug). */
  key: string;
  /** `resolveFundBondCountryId` equivalent, resolved by the caller. */
  homeCountryId: string;
  scope: "country" | "global";
  kind: "broad" | "sector" | "bond";
  /** Serviceable in the cron sense: active, or paused on backing ratio. */
  active: boolean;
  /** Cash the fund may deploy into bonds after the reserve target and the
   * 5% cash buffer (`cashAvailableForBondDeployAnchor`). */
  deployableCashAnchor: number;
  /** Cash above the 5% buffer regardless of the reserve target. */
  cashAboveBufferAnchor: number;
  /** Present for bond-kind funds; absent means the equity reserve mandate
   * (home paper for country funds, home-mapped paper for global funds until
   * the cross-border flag opens the world book). */
  bondUniverse?: BondFundUniverse;
}

/** Convertibility snapshot for the issue currencies, from `exchangeRates`. */
export interface SovereignDemandGapFx {
  /** Currencies with a live positive rate a foreign fund can price. */
  tradableCurrencies: readonly string[];
  /** Currencies under capital controls: foreign funds are excluded. */
  controlledCurrencies: readonly string[];
}

function ratingIndexForGap(rating: string | undefined): number {
  const idx = CREDIT_RATINGS.indexOf((rating ?? "BBB") as CreditRating);
  return idx >= 0 ? idx : CREDIT_RATINGS.indexOf("BBB");
}

/** Mirror of `ratingWithinUniverse`: the worst grade allowed is `minRating`. */
function universeAdmitsRating(
  rating: string | undefined,
  universe: Pick<BondFundUniverse, "minRating" | "maxRating">
): boolean {
  const idx = ratingIndexForGap(rating);
  if (universe.minRating && idx > CREDIT_RATINGS.indexOf(universe.minRating)) return false;
  if (universe.maxRating && idx < CREDIT_RATINGS.indexOf(universe.maxRating)) return false;
  return true;
}

function bondCurrencyForGap(bond: {
  countryId: string | null;
  currencyCode?: string | null;
}): string {
  if (bond.currencyCode) return bond.currencyCode;
  if (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP) {
    return COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP];
  }
  return "USD";
}

/**
 * Funds whose mandate lists this issue, before cash and cap limits.
 * Country funds (equity or home-only bond funds) buy home paper only;
 * global equity funds buy foreign paper only behind the cross-border flag;
 * global sovereign bond funds buy wherever their rating universe, a live FX
 * rate, and open capital account admit them. Foreign country funds never buy
 * foreign paper. Home paper always clears the currency gates.
 */
function mandateFunds(
  countryId: string,
  currencyCode: string,
  rating: string | undefined,
  funds: readonly SovereignDemandGapFund[],
  fx: SovereignDemandGapFx,
  crossBorderEnabled: boolean
): { domestic: SovereignDemandGapFund[]; global: SovereignDemandGapFund[] } {
  const tradable = new Set(fx.tradableCurrencies);
  const controlled = new Set(fx.controlledCurrencies);
  const domestic: SovereignDemandGapFund[] = [];
  const global: SovereignDemandGapFund[] = [];
  for (const fund of funds) {
    if (!fund.active) continue;
    if (fund.homeCountryId === countryId) {
      if (fund.kind === "bond") {
        // Home paper always clears the scope gate: a global bond fund homed
        // here buys it exactly like a home-only fund does
        // (`isGlobalFundBondEligible` returns true for the home country).
        const universe = fund.bondUniverse;
        if (!universe || universe.issuerType !== "sovereign") continue;
        if (!universeAdmitsRating(rating, universe)) continue;
        domestic.push(fund);
      } else {
        domestic.push(fund);
      }
      continue;
    }
    if (fund.scope !== "global") continue;
    if (fund.kind === "bond") {
      const universe = fund.bondUniverse;
      if (!universe || universe.issuerType !== "sovereign") continue;
      if (universe.homeOnly === true) continue;
      if (!universeAdmitsRating(rating, universe)) continue;
      if (!tradable.has(currencyCode) || controlled.has(currencyCode)) continue;
      global.push(fund);
      continue;
    }
    if (!crossBorderEnabled) continue;
    if (!tradable.has(currencyCode) || controlled.has(currencyCode)) continue;
    global.push(fund);
  }
  return { domestic, global };
}

/** Whole units every candidate fund may still take under the holder cap. */
function remainingCapUnits(
  totalIssued: number,
  faceValue: number,
  candidates: readonly SovereignDemandGapFund[],
  heldUnitsByFundKey: ReadonlyMap<string, number>
): number {
  if (!(totalIssued > 0)) return Number.MAX_SAFE_INTEGER;
  const face = faceValue > 0 ? faceValue : BOND_UNIT_FACE_VALUE;
  const totalUnits = totalIssued / face;
  if (!(totalUnits > 0)) return Number.MAX_SAFE_INTEGER;
  const capUnits = Math.floor(SOVEREIGN_BOND_HOLDER_CAP * totalUnits);
  let remaining = 0;
  for (const fund of candidates) {
    remaining += Math.max(0, capUnits - (heldUnitsByFundKey.get(fund.key) ?? 0));
  }
  return remaining;
}

export interface SovereignDemandGapIssue {
  countryId: string | null;
  currencyCode?: string | null;
  totalIssued: number;
  faceValue?: number;
  publicFloat: number;
  /** Whole units each candidate fund already holds in this issue. */
  heldUnitsByFundKey?: ReadonlyMap<string, number>;
}

/**
 * Assign the single reproducible primary reason an unheld live sovereign
 * issue has no fund holder. Pure: the caller loads funds, ratings, FX rows,
 * and the cross-border flag; every comparison is order-independent, so the
 * same book always yields the same reason.
 */
export function classifySovereignDemandGap(
  issue: SovereignDemandGapIssue,
  funds: readonly SovereignDemandGapFund[],
  fx: SovereignDemandGapFx,
  ratingByCountry: ReadonlyMap<string, string | undefined>,
  crossBorderEnabled: boolean
): SovereignDemandGapReason {
  if (!(issue.publicFloat > 0)) return "no_float";
  const countryId = issue.countryId ?? "unknown";
  const currencyCode = bondCurrencyForGap(issue);
  const rating = ratingByCountry.get(countryId);
  const { domestic, global } = mandateFunds(
    countryId,
    currencyCode,
    rating,
    funds,
    fx,
    crossBorderEnabled
  );
  if (domestic.length === 0 && global.length === 0) {
    // No mandate lists this issue. The foreign gates come first: when
    // funds exist abroad but a switch excludes them, the switch is the
    // actionable reason, not the missing domestic fund.
    const reachableIfOpen = mandateFunds(countryId, currencyCode, rating, funds, fx, true);
    if (reachableIfOpen.global.length > 0 && !crossBorderEnabled) {
      return "cross_border_disabled";
    }
    // Name an FX gate only when a foreign fund actually waits behind it;
    // otherwise the missing domestic fund below is the honest reason.
    const fxBlocked = funds.some(
      (fund) =>
        fund.active &&
        fund.homeCountryId !== countryId &&
        fund.scope === "global" &&
        (fund.kind === "bond"
          ? fund.bondUniverse?.issuerType === "sovereign" &&
            fund.bondUniverse.homeOnly !== true &&
            universeAdmitsRating(rating, fund.bondUniverse)
          : true)
    );
    if (fxBlocked) {
      if (new Set(fx.controlledCurrencies).has(currencyCode)) return "capital_controls";
      if (!new Set(fx.tradableCurrencies).has(currencyCode)) return "currency_mismatch";
    }
    const homed = funds.filter((fund) => fund.active && fund.homeCountryId === countryId);
    if (homed.length === 0) return "no_domestic_fund";
    // Funds homed here exist, but none may buy sovereign paper at this
    // rating: corporate-only universes, or a rating band that excludes it.
    // (An active homed fund with a sovereign mandate that admits the rating
    // would already sit in `domestic` above.)
    return "ineligible";
  }
  const candidates = [...domestic, ...global];
  const deployable = candidates.reduce(
    (sum, fund) =>
      sum +
      (Number.isFinite(fund.deployableCashAnchor) ? Math.max(0, fund.deployableCashAnchor) : 0),
    0
  );
  if (!(deployable > 0)) {
    const aboveBuffer = candidates.reduce(
      (sum, fund) =>
        sum +
        (Number.isFinite(fund.cashAboveBufferAnchor) ? Math.max(0, fund.cashAboveBufferAnchor) : 0),
      0
    );
    return aboveBuffer > 0 ? "reserve_target_met" : "cash_buffer";
  }
  const capacity = remainingCapUnits(
    issue.totalIssued,
    issue.faceValue ?? BOND_UNIT_FACE_VALUE,
    candidates,
    issue.heldUnitsByFundKey ?? new Map()
  );
  if (!(capacity >= 1)) return "position_limit";
  return "awaiting_demand";
}

/**
 * Count unheld live sovereign issues per country by primary demand-gap
 * reason. Held issues never enter the funnel; the counts in each row sum to
 * that country's unheld issue count. Order is by country id for determinism.
 */
export function summarizeSovereignDemandGapsByCountry(
  issues: readonly {
    countryId: string | null;
    holderCount: number;
    gap: SovereignDemandGapReason;
  }[]
): { countryId: string; unheldIssueCount: number; byReason: Record<string, number> }[] {
  const byCountry = new Map<string, Map<SovereignDemandGapReason, number>>();
  for (const issue of issues) {
    if (issue.holderCount !== 0) continue;
    const key = issue.countryId ?? "unknown";
    let counts = byCountry.get(key);
    if (!counts) {
      counts = new Map();
      byCountry.set(key, counts);
    }
    counts.set(issue.gap, (counts.get(issue.gap) ?? 0) + 1);
  }
  return [...byCountry.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([countryId, counts]) => {
      const byReason: Record<string, number> = {};
      for (const [reason, count] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        byReason[reason] = count;
      }
      const unheldIssueCount = [...counts.values()].reduce((sum, count) => sum + count, 0);
      return { countryId, unheldIssueCount, byReason };
    });
}
