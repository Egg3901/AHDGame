/**
 * Financial fog-of-war for public corporations.
 *
 * Public corps update displayed financials every 12 turns (one "quarter").
 * Between updates, viewers without insider access see a perturbed estimate
 * derived from the most recent quarterly snapshot.
 *
 * Exceptions (always see live data):
 *   - CEO of the corporation
 *   - CEO of a controlling parent corporation (>50% stake)
 *   - Admins
 */

import type { Financials, BalanceSheet } from "@/components/corporation/CorporationPageTypes";
import type { CorporationHistory } from "@/lib/db/types/corporationHistory";

/** Number of turns between public financial disclosures. */
export const FINANCIAL_FOG_QUARTER_TURNS = 12;

/**
 * Widest deviation any fogged figure can carry (±10%).
 *
 * C3: this constant is what the UI is allowed to tell a non-insider. The
 * per-corp `fogFactor` itself used to be served on the payload, which handed
 * every outsider the exact multiplier and made every fogged number trivially
 * invertible — the fog was decoration. Only the envelope is public now.
 */
export const FINANCIAL_FOG_MAX_DEVIATION = 0.1;

/**
 * Deterministic fog multiplier in the range [0.90, 1.10] for a given corp and
 * quarter boundary. Changes once per quarter so the estimate is stable within
 * a quarter but shifts at each new disclosure window.
 *
 * `variant` salts the hash so a caller can draw an INDEPENDENT multiplier for
 * the same corp and quarter. That is not cosmetic: any two figures sharing one
 * factor publish their exact ratio, because the factor cancels. See
 * `applyFogToSectorPhysicals`.
 */
export function getFogFactor(corpId: string, currentTurn: number, variant = ""): number {
  const quarterBoundary = Math.floor(currentTurn / FINANCIAL_FOG_QUARTER_TURNS);
  const seed = corpId + ":" + String(quarterBoundary) + (variant ? ":" + variant : "");
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = (((hash << 5) + hash) ^ seed.charCodeAt(i)) | 0;
  }
  // Map to [0, 1]
  const normalized = (Math.abs(hash) % 100_000) / 100_000;
  // Scale to [0.90, 1.10]
  return 0.9 + normalized * 0.2;
}

/** Apply fog to a single number value. */
function fog(value: number, factor: number): number {
  return Math.round(value * factor);
}

/**
 * Total costs per turn as shown on the Financials tab (`financials.totalCosts` / 24):
 * operating costs plus gross bond coupon expense (before natcorp subsidy).
 * History stores operating in `totalCosts`; bond interest is split out for net-income math.
 */
export function totalCostsPerTurnFromParts(parts: {
  totalCosts: number;
  perTurnBondInterestExpense?: number;
  perTurnBondDragOnNetIncome?: number;
}): number {
  const bondInterest = parts.perTurnBondInterestExpense ?? parts.perTurnBondDragOnNetIncome ?? 0;
  return parts.totalCosts + bondInterest;
}

export function historyTotalCostsPerTurn(history: CorporationHistory): number {
  return totalCostsPerTurnFromParts(history);
}

/**
 * Realized per-turn net income for display, reconstructed from a history
 * snapshot to match the live income-statement definition.
 *
 * The engine persists `history.income` as the OPERATING result only — bond
 * coupon income and bond interest settle in a separate bond phase and land
 * directly in `liquidCapital` (sectorCalculations.ts:1452), so they are
 * excluded from the stored field. For a corp whose earnings are dominated by
 * a bond portfolio (support #941 / #942) that stored value is deeply negative
 * even while the corp is plainly profitable and its cash rises every turn —
 * and it disagrees in sign with the coupon-inclusive Financials "Net income".
 *
 * Fold the persisted coupon income back in and net out the interest drag so
 * the realized figure equals the corp's true per-turn cash contribution
 * (operating result + coupon − interest), matching both the income statement
 * and the observed `liquidCapital` delta. Both components are persisted from
 * the same turn; older rows that predate them fall back to `history.income`.
 */
export function realizedNetIncomePerTurn(history: CorporationHistory): number {
  return (
    history.income +
    (history.perTurnBondCouponIncome ?? 0) -
    (history.perTurnBondDragOnNetIncome ?? 0)
  );
}

/**
 * Return a copy of `financials` with all monetary values scaled by `factor`.
 * The scale is applied uniformly so ratios (e.g. effective margin) are preserved.
 */
export function applyFogToFinancials(financials: Financials, factor: number): Financials {
  return {
    totalRevenue: fog(financials.totalRevenue, factor),
    maintenanceCosts: fog(financials.maintenanceCosts, factor),
    laborCosts: fog(financials.laborCosts, factor),
    growthCosts: fog(financials.growthCosts, factor),
    marketingCosts: fog(financials.marketingCosts, factor),
    logisticsCosts: fog(financials.logisticsCosts, factor),
    rdCosts: fog(financials.rdCosts, factor),
    ceoSalaryCost: fog(financials.ceoSalaryCost, factor),
    pensionContributionCost: fog(financials.pensionContributionCost, factor),
    pensionTopUpCost: fog(financials.pensionTopUpCost, factor),
    // A count, not money. Fogging it would report a different number of schemes.
    pensionSchemesInDeficit: financials.pensionSchemesInDeficit,
    operatingCosts: fog(financials.operatingCosts, factor),
    operatingIncome: fog(financials.operatingIncome, factor),
    federalTax: fog(financials.federalTax, factor),
    stateTax: fog(financials.stateTax, factor),
    federalTaxByCountry: Object.fromEntries(
      Object.entries(financials.federalTaxByCountry).map(([k, v]) => [k, fog(v, factor)])
    ),
    bondInterestCost: fog(financials.bondInterestCost, factor),
    bondCouponIncome: fog(financials.bondCouponIncome, factor),
    governmentBondSubsidy: fog(financials.governmentBondSubsidy, factor),
    imfFacilityPaymentDaily: fog(financials.imfFacilityPaymentDaily, factor),
    imfFacilityReceiptsDaily: fog(financials.imfFacilityReceiptsDaily, factor),
    totalCosts: fog(financials.totalCosts, factor),
    income: fog(financials.income, factor),
    dividendRate: financials.dividendRate,
    effectiveDividendRate: financials.effectiveDividendRate,
    dividendDistribution: fog(financials.dividendDistribution, factor),
    dividendIncomeReceived: fog(financials.dividendIncomeReceived, factor),
    regulatoryBurden: fog(financials.regulatoryBurden, factor),
    currentGrowthRate: financials.currentGrowthRate,
    subsidyBenefit: fog(financials.subsidyBenefit, factor),
  };
}

/**
 * Return a copy of `balanceSheet` with monetary values scaled by `factor`.
 * Structural counts (bondCount) and rates are left unchanged.
 */
export function applyFogToBalanceSheet(balanceSheet: BalanceSheet, factor: number): BalanceSheet {
  const a = balanceSheet.assets;
  const l = balanceSheet.liabilities;
  const e = balanceSheet.equity;

  return {
    assets: {
      cashOnHand: fog(a.cashOnHand, factor),
      sectorNPVs: a.sectorNPVs.map((s) => ({
        ...s,
        dailyProfit: fog(s.dailyProfit, factor),
        npv: fog(s.npv, factor),
      })),
      totalSectorNPV: fog(a.totalSectorNPV, factor),
      bondHoldingsValue: fog(a.bondHoldingsValue, factor),
      stockHoldingsValue: fog(a.stockHoldingsValue, factor),
      imfFacilityReceivablesValue: fog(a.imfFacilityReceivablesValue, factor),
      imfFacilityReceivables: a.imfFacilityReceivables.map((r) => ({
        ...r,
        principalOutstanding: fog(r.principalOutstanding, factor),
      })),
      totalPortfolioValue: fog(a.totalPortfolioValue, factor),
      heldBonds: a.heldBonds,
      techAssetValue: fog(a.techAssetValue, factor),
      totalAssets: fog(a.totalAssets, factor),
    },
    liabilities: {
      dailyCosts: fog(l.dailyCosts, factor),
      totalDebt: fog(l.totalDebt, factor),
      dailyInterestCost: fog(l.dailyInterestCost, factor),
      bondCount: l.bondCount,
    },
    equity: {
      totalEquity: fog(e.totalEquity, factor),
      bookValue: fog(e.bookValue, factor),
      marketCapitalization: fog(e.marketCapitalization, factor),
    },
  };
}

/**
 * Build a minimal "last quarterly" financials summary from a CorporationHistory
 * snapshot. Only populates the fields that history tracks; the rest are null.
 */
export function buildQuarterlySnapshot(history: CorporationHistory | null): {
  revenue: number | null;
  income: number | null;
  totalCosts: number | null;
  liquidCapital: number | null;
  marketingStrength: number | null;
  logisticsStrength: number | null;
  turn: number | null;
  currencyCode: string | null;
} {
  if (!history) {
    return {
      revenue: null,
      income: null,
      totalCosts: null,
      liquidCapital: null,
      marketingStrength: null,
      logisticsStrength: null,
      turn: null,
      currencyCode: null,
    };
  }
  return {
    revenue: history.revenue,
    income: realizedNetIncomePerTurn(history),
    totalCosts: historyTotalCostsPerTurn(history),
    liquidCapital: history.liquidCapital,
    marketingStrength: history.marketingStrength,
    logisticsStrength: history.logisticsStrength ?? null,
    turn: history.turn,
    currencyCode: history.currencyCode ?? null,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Plants tier: physical disclosure.
 *
 * Under `marketSystemMode >= "plants"` a sector is a set of PLANTS. Capacity,
 * output and sales are physical quantities, and they are exactly the numbers a
 * rival wants before deciding whether to attack a market. They therefore need
 * the same quarterly-disclosure treatment the money figures already get — with
 * one deliberate exception, below.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Coarse fill-rate disclosure band.
 *
 * Fill rate (sold ÷ produced) is ATTACK-TARGETING INTEL, not a financial
 * headline. A rival who can read "this plant is running at 31%" knows the
 * incumbent cannot defend the market and knows precisely how much unsold
 * capacity is sitting there — which is a far sharper weapon than the ±10%
 * money estimate, because it does not degrade with the size of the corp.
 *
 * So the raw ratio is owner/insider-only, and outsiders get one of three
 * bands. The bands are wide enough that watching them across quarters does
 * not reconstruct the number.
 */
export type FillRateBand = "high" | "medium" | "low";

/** Inclusive lower bound of each band, as a fraction of produced units. */
export const FILL_RATE_BAND_MIN: Record<FillRateBand, number> = {
  high: 0.8,
  medium: 0.4,
  low: 0,
};

/** Player-facing band labels. Plain language, no dashes. */
export const FILL_RATE_BAND_LABEL: Record<FillRateBand, string> = {
  high: "Selling nearly all output",
  medium: "Selling most output",
  low: "Leaving output unsold",
};

/** Short chip text for the band. */
export const FILL_RATE_BAND_SHORT: Record<FillRateBand, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * Fill rate as a fraction in [0, 1]: the share of what a sector produced that
 * it actually sold. Null when the sector produced nothing this turn (a
 * mothballed or not-yet-online sector has no fill rate, and 0/0 must not read
 * as "selling nothing").
 */
export function computeFillRate(
  producedUnits: number | null | undefined,
  soldUnits: number | null | undefined
): number | null {
  if (producedUnits == null || soldUnits == null) return null;
  if (!Number.isFinite(producedUnits) || !Number.isFinite(soldUnits)) return null;
  if (producedUnits <= 0) return null;
  return Math.max(0, Math.min(1, soldUnits / producedUnits));
}

/** Band a fill rate falls in. Null in, null out. */
export function fillRateBand(fill: number | null | undefined): FillRateBand | null {
  if (fill == null || !Number.isFinite(fill)) return null;
  if (fill >= FILL_RATE_BAND_MIN.high) return "high";
  if (fill >= FILL_RATE_BAND_MIN.medium) return "medium";
  return "low";
}

/** The physical figures a plants-tier sector publishes. All DAILY, units-based. */
export interface SectorPhysicals {
  /** Nameplate productive capacity, output units per day (`capitalStock`). */
  capacityUnits: number | null;
  /** Units produced last turn. */
  producedUnits: number | null;
  /** Units sold last turn. */
  soldUnits: number | null;
  /** Construction in progress, ₳ — capacity paid for but not yet productive. */
  constructionInProgressAnchor: number | null;
}

/** What an outsider sees: perturbed quantities, and a band instead of a ratio. */
export interface FoggedSectorPhysicals extends SectorPhysicals {
  /** Always null for a fogged view — the exact ratio is insider-only. */
  fillRate: null;
  /** The coarse band, derived from the TRUE figures (see below). */
  fillRateBand: FillRateBand | null;
}

/**
 * The three independent multipliers a fogged physical row needs.
 * Build one per corp per quarter with `getSectorPhysicalsFogFactors`.
 */
export interface SectorPhysicalsFogFactors {
  /** Capacity + construction in progress. Shares the money factor by design. */
  base: number;
  /** Units produced. Independent of `sold`. */
  produced: number;
  /** Units sold. Independent of `produced`. */
  sold: number;
}

/**
 * Draw the physical fog factors for a corp/quarter.
 *
 * `base` is the same factor the money lines use, deliberately: under plants,
 * revenue is capacity × mix price, so capacity and revenue must move together
 * or the two published figures contradict each other and the pair discloses the
 * true value anyway.
 *
 * `produced` and `sold` are SALTED SEPARATELY. Under the previous single-factor
 * scheme the factor cancelled exactly in `sold / produced`, so the pair
 * published the true FILL RATE to the last digit — the one number the module
 * goes out of its way to withhold, handed over in full by the very transform
 * meant to hide it. Independent draws break the cancellation.
 */
export function getSectorPhysicalsFogFactors(
  corpId: string,
  currentTurn: number
): SectorPhysicalsFogFactors {
  return {
    base: getFogFactor(corpId, currentTurn),
    produced: getFogFactor(corpId, currentTurn, "produced"),
    sold: getFogFactor(corpId, currentTurn, "sold"),
  };
}

/**
 * Apply the quarterly fog to one sector's physical figures.
 *
 * The band is computed from the TRUE produced and sold units, not the fogged
 * pair: the fogged pair is now deliberately inconsistent (two independent
 * factors), so deriving the band from it would let a rounding artefact at small
 * unit counts flip a rival's band for no informational reason.
 */
export function applyFogToSectorPhysicals(
  physicals: SectorPhysicals,
  factors: SectorPhysicalsFogFactors
): FoggedSectorPhysicals {
  const fogNullable = (v: number | null, f: number) => (v == null ? null : fog(v, f));
  return {
    capacityUnits: fogNullable(physicals.capacityUnits, factors.base),
    producedUnits: fogNullable(physicals.producedUnits, factors.produced),
    soldUnits: fogNullable(physicals.soldUnits, factors.sold),
    constructionInProgressAnchor: fogNullable(physicals.constructionInProgressAnchor, factors.base),
    fillRate: null,
    fillRateBand: fillRateBand(computeFillRate(physicals.producedUnits, physicals.soldUnits)),
  };
}

export interface FinancialFogMeta {
  isFinancialFogOfWar: true;
  /** The turn from which the last quarterly snapshot was taken. */
  fogSourceTurn: number | null;
  /**
   * C3: the exact per-corp multiplier is NOT published. Serving it let any
   * viewer divide it back out and recover every "fogged" figure exactly. Only
   * the envelope is disclosed, so the UI can still say "estimated ±10%".
   */
  maxDeviation: number;
  /** Last known quarterly values (from history). */
  lastQuarterly: ReturnType<typeof buildQuarterlySnapshot>;
}

/**
 * Whether a corporation's books are currently public because they were leaked.
 *
 * Lives here with the rest of the fog rules rather than inline in the route: it
 * is a rule about who may read a company's financials, which is exactly what
 * this module is for, and keeping it here makes it testable on its own.
 *
 * Expressed as a turn so the exposure lapses by itself and nothing has to
 * remember to clear it. An absent or past turn means the ordinary quarterly fog
 * applies.
 */
export function booksAreExposed(
  corp: { booksExposedUntilTurn?: number | null },
  currentTurn: number
): boolean {
  const until = corp.booksExposedUntilTurn;
  if (typeof until !== "number" || !Number.isFinite(until)) return false;
  return currentTurn <= until;
}
