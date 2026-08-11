import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Shareholder } from "./corporation";

/**
 * Per-corporation snapshot taken each turn during turn processing.
 * Used for historical charts on the corporation detail page.
 *
 * Starting v0.2.6, every money-valued field (sharePrice, marketCap,
 * revenue, income, etc.) is denominated in `currencyCode` — which matches
 * the owning corp's `liquidCurrencyCode` at snapshot time. Pre-migration
 * entries (no currencyCode) are in ₳ (anchor). The 0.2.6 migration script
 * retroactively backfills old entries by the corp's rate at cutover.
 */
export interface CorporationHistory {
  _id: ObjectId;
  corporationId: ObjectId;
  turn: number;
  /**
   * Currency all money-valued fields in this snapshot are denominated in.
   * Missing on pre-v0.2.6 entries (those are ₳). Post-migration backfill
   * fills this in for every entry.
   */
  currencyCode?: CurrencyCode;
  /**
   * The `currencyCode` FX rate (local per 1 ₳) in effect when this row was
   * written. Readers converting this row's money fields back to ₳ MUST use
   * this rate, not the live/current rate — reconverting with today's rate
   * drifts by however much FX has moved since this turn (#2958). Missing on
   * rows written before this field existed, or when `currencyCode` itself is
   * absent (pre-forex ₳ passthrough — no conversion needed).
   */
  fxRateAtWrite?: number;
  /** Share price at snapshot time. */
  sharePrice: number;
  /** Total shares outstanding at snapshot time (for split-adjusted comparisons) */
  totalShares: number;
  /**
   * Shareholder register at snapshot time. Added so future stock splits
   * and reverse splits remain auditable even if the corporation's live
   * shareholders array is later modified. Omitted on pre-v0.2.7 entries.
   */
  shareholders?: Shareholder[];
  /**
   * Public float at snapshot time. Paired with `shareholders` above so
   * `shareholders.shares.sum + publicFloat = totalShares`.
   * Omitted on pre-v0.2.7 entries.
   */
  publicFloat?: number;
  marketCap: number;
  liquidCapital: number;
  /**
   * Market-making buyback escrow balance at snapshot time, in liquidCurrencyCode
   * units. May be negative (a tracked buyback debt). Snapshotted so forensics can
   * see true net cash (`liquidCapital + shareEscrowBalance`) per turn and catch
   * escrow drift that inflates the displayed gross liquidCapital. Omitted on
   * entries written before this field was added.
   */
  shareEscrowBalance?: number;
  revenue: number;
  totalCosts: number;
  income: number;
  /** Total dividend paid to all shareholders this turn (matches turn processor). */
  dividendPaidPerTurn?: number;
  /**
   * Net dividend income (local ccy, per-turn) this corp RECEIVED from holding
   * other corps' shares — after FX spread + the 50% dividend-received-deduction
   * tax. Reporting only (the cash was credited to liquidCapital in the dividend
   * phase, NOT via `income`). Surfaced as a Financials P&L line (#3109). Absent
   * when the corp holds no dividend-paying corp shares.
   */
  dividendIncomeReceived?: number;
  /** Pre-tax operating income minus overhead, before bond flows (₳/turn). Older snapshots lack this field. */
  incomePreDividends?: number;
  /**
   * Sum of per-sector NPVs (₳). Persisted so the post-bond-turn share-price
   * recompute can reuse it without re-deriving from sectors.
   * Older snapshots lack this field.
   */
  sectorNPV?: number;
  /**
   * Coupon income earned as a bond holder this turn (₳/turn). Persisted so
   * the post-bond-turn share-price recompute can include it in the income
   * basis. Older snapshots lack this field.
   */
  perTurnBondCouponIncome?: number;
  /**
   * Gross bond coupon expense on issued bonds this turn (₳/turn), before natcorp
   * subsidy. Matches `financials.bondInterestCost / 24`. Older snapshots lack this
   * field — fall back to {@link perTurnBondDragOnNetIncome} for non-natcorps only.
   */
  perTurnBondInterestExpense?: number;
  /**
   * Bond interest expense this turn — zero for national enterprises (₳/turn).
   * Persisted alongside perTurnBondCouponIncome for the recompute phase.
   * Older snapshots lack this field.
   */
  perTurnBondDragOnNetIncome?: number;
  /** Total corporate tax paid this turn, federal + state/regional combined (₳/turn). */
  corporateTaxPaid?: number;
  /** Federal corporate tax paid this turn, summed across all countries (₳/turn). */
  federalTaxPaid?: number;
  /** State/regional corporate tax paid this turn, summed across all states/regions (₳/turn). */
  stateTaxPaid?: number;
  /** Per-country federal tax paid (₳/turn). Only populated when non-zero. */
  taxPaidByCountry?: Record<string, number>;
  /** Per-state/region state tax paid (₳/turn). Only populated when non-zero. */
  taxPaidByState?: Record<string, number>;
  /** Federal tax from corps HQ'd in the same country as the sector (domestic). */
  taxPaidByCountryDomestic?: Record<string, number>;
  /** Federal tax from corps HQ'd elsewhere (foreign). */
  taxPaidByCountryForeign?: Record<string, number>;
  /** State tax from corps HQ'd in the same country as the sector's country. */
  taxPaidByStateDomestic?: Record<string, number>;
  /** State tax from corps HQ'd outside the sector's country. */
  taxPaidByStateForeign?: Record<string, number>;
  marketingStrength: number;
  logisticsStrength: number;
  dividendRate: number;
  /** Brand loyalty 0–100 (brandLoyaltyEnabled); for the charts-tab time series. */
  brandLoyalty?: number;
  /** Revenue-weighted mean output quality 0–100 (quality pillars, Package B). */
  averageQuality?: number;
  /**
   * Physical output units per commodity this turn (corp-wide). Keys are
   * `CommodityType` strings. Global supply share is derived at read time from
   * `commodityFlows.supplyUnits` for the same turn.
   */
  commodityOutput?: Record<string, number>;
  /** Composite credit score (0–100), same formula as bonds tab; set from turn processor. */
  creditComposite?: number;
  /** Letter rating tier (AAA … CCC). */
  creditRating?: string;
  /**
   * Per-turn margin diagnostic: revenue-weighted averages across all sectors.
   * Used to diagnose cost/revenue spikes — shows which modifier category is responsible.
   */
  marginDiagnostic?: {
    /** Revenue-weighted average effective margin (profitMargin + all mods) */
    effectiveMargin: number;
    /** Revenue-weighted commodity input modifier (from supply/demand pressure) */
    commodityInputMod: number;
    /** Revenue-weighted commodity surplus modifier */
    commoditySurplusMod: number;
    /** Revenue-weighted export-reward premium (trade into foreign deficits). Optional — absent on history rows written before Phase 5. */
    exportPremiumMod?: number;
    /** Combined inflation + debt-to-GDP + deficit modifier */
    macroMod: number;
    /** Combined state metrics modifier (unemployment, grid, corruption, etc.) */
    stateMetricsMod: number;
    /** Temporary audit value for the previous sparse state-metric margin system. */
    legacyStateMetricsMod?: number;
    /** hourlyGrowthCost / hourlyRevenue ratio */
    growthCostRatio: number;
    /** Number of sectors */
    sectorCount: number;
  };
  createdAt: Date;
}
