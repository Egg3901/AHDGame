/**
 * ONE plants-aware sector profit / book-value basis.
 *
 * Every "what is this sector worth" surface (credit model, bond issuance,
 * dissolution salvage, listing quotes, nationalization compensation) used to
 * re-derive the same expression independently:
 *
 *     dailyProfit = revenue × margin − growthCost
 *
 * ...each with its own FX discipline and its own way of getting `growthCost`
 * (recompute it from `calculateDailyGrowthCost`, or read the persisted
 * `currentGrowthCost`). Under the plants tier (marketSystemMode >= "plants")
 * the growth slider no longer buys capacity — capacity is bought with explicit
 * build orders and capitalized as construction-in-progress — so the growth cost
 * is vestigial and DEDUCTING it is a phantom charge that makes every sector
 * look permanently less valuable than it is.
 *
 * This module is the single place that knows that. Callers keep owning their FX
 * discipline (they pass the currency code + rate that is right for their call
 * site — corp-liquid currency for the credit paths, sector-host currency for
 * the listing path); this module owns the profit identity and the plants rule.
 *
 * Below "plants" every function here is behaviour-identical to the expression
 * it replaced.
 */
import { calculateDailyGrowthCost, GROWTH_RATE_TURNS_PER_YEAR } from "@/lib/constants/corporations";
import {
  capacityPricePerUnit,
  revenuePerCapacityUnitForStrategy,
} from "@/lib/constants/capacityEconomy";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { sectorEconomicRevenue } from "@/lib/corporations/sectorRevenueBasis";

/** Margin used when a sector doc predates `profitMargin` being written. */
export const DEFAULT_SECTOR_PROFIT_MARGIN_PCT = 35;

/**
 * Book-value haircut applied on top of replacement cost when settling a sector
 * at book (dissolution salvage, nationalization compensation).
 *
 * Deliberately 1.0: `capitalStock` is ALREADY the depreciated quantity — the
 * turn processor shrinks it every turn via `advanceCapitalStock` — so pricing
 * the surviving units at replacement cost is the depreciated book value. This
 * constant exists as the named tuning hook for the day worldsim says book
 * should sit below replacement cost (e.g. an obsolescence wedge); changing it
 * moves salvage AND nationalization compensation together, which is the point.
 * Tunable.
 */
export const BOOK_DEPRECIATION_FACTOR = 1.0;

/** The sector fields the profit basis reads. Structural so partial projections fit. */
export interface SectorProfitBasisInput {
  revenue?: number | null;
  realizedRevenue?: number | null;
  profitMargin?: number | null;
  /** Engine-applied margin from the last processed turn — preferred over the CEO-set base. */
  effectiveProfitMargin?: number | null;
  currentGrowthRate?: number | null;
  currentGrowthCost?: number | null;
}

/**
 * How the caller wants the growth cost sourced.
 *
 * - `recomputed` re-derives it from the sector's live growth rate and the host
 *   country's prime rate (the credit / NPV paths).
 * - `stored` reads the persisted `currentGrowthCost` the turn processor wrote
 *   (the listing-quote path, which wants a figure that matches the sector page).
 *
 * Both are ignored entirely under plants.
 */
export type SectorGrowthCostBasis =
  | {
      kind: "recomputed";
      /** Country prime rate, in the same units `calculateDailyGrowthCost` takes. */ primeRate: number;
    }
  | { kind: "stored" };

export interface SectorProfitBasisOptions {
  /**
   * True when marketSystemMode >= "plants". When true the growth-cost
   * deduction is dropped: growth spend no longer buys capacity, so charging
   * for it in a valuation is a phantom expense.
   *
   * Callers that genuinely cannot resolve the mode (pure/synchronous contexts)
   * may pass `false`, which reproduces the legacy behaviour exactly.
   */
  plantsEnabled: boolean;
  growthCost: SectorGrowthCostBasis;
  /**
   * Currency the sector's economic fields are stored in, and the ₳ rate for it.
   * Passed by the caller so each call site keeps its own FX discipline (corp
   * liquid currency vs sector host currency). Omit both for ₳-on-disk callers.
   */
  currencyCode?: CurrencyCode;
  fxRate?: number;
  /**
   * Force the growth deduction off regardless of mode. Used by the
   * nationalization "steady-state earning power" basis, which excludes the
   * owner's discretionary growth spend on purpose (Bug #0775 follow-up).
   */
  excludeGrowthCost?: boolean;
}

export interface SectorProfitBasis {
  /** Daily revenue in ₳ (realized-preferring). */
  revenueAnchor: number;
  /** Daily maintenance in ₳ (revenue × (1 − margin)). */
  maintenanceAnchor: number;
  /** Daily growth cost in ₳. Always 0 under plants. */
  growthCostAnchor: number;
  /** revenue − maintenance − growthCost, daily, in ₳. */
  dailyProfitAnchor: number;
}

/**
 * Plants-aware daily profit for one sector, in ₳.
 *
 * Below "plants" this is byte-identical to the four expressions it replaced:
 * revenue is realized-preferring and FX-normalized with the caller's own code +
 * rate, maintenance is `revenue × (1 − margin/100)`, and the growth cost is
 * either recomputed or read from disk exactly as before. Under "plants" the
 * growth term is 0.
 */
export function sectorDailyProfitAnchor(
  sector: SectorProfitBasisInput,
  opts: SectorProfitBasisOptions
): SectorProfitBasis {
  const code = opts.currencyCode;
  const rate = opts.fxRate ?? 1;
  const revenueAnchor = readCorpEconomicAnchor(
    sectorEconomicRevenue({
      revenue: sector.revenue ?? 0,
      realizedRevenue: sector.realizedRevenue ?? undefined,
    }),
    code,
    rate
  );
  // Prefer the margin the engine actually applied last turn. Under plants the
  // stored `effectiveProfitMargin` is derived from the physical P&L (labor,
  // upkeep, inputs — sectorTurn.ts P3.5); below plants it is last turn's full
  // modifier stack. The CEO-set base `profitMargin` (typically 35) knows about
  // neither, and pricing collateral on it let corps borrow against loss-making
  // sectors as if they earned 35% while under-crediting genuinely high-margin
  // ones (ops-knowledge: ahd-corp-sector-npv-divergence). Base survives only
  // as the fallback for sectors that have never processed a turn.
  const marginPct =
    sector.effectiveProfitMargin ?? sector.profitMargin ?? DEFAULT_SECTOR_PROFIT_MARGIN_PCT;
  const maintenanceAnchor = revenueAnchor * (1 - marginPct / 100);

  let growthCostAnchor = 0;
  if (!opts.plantsEnabled && !opts.excludeGrowthCost) {
    if (opts.growthCost.kind === "stored") {
      growthCostAnchor = readCorpEconomicAnchor(sector.currentGrowthCost ?? 0, code, rate);
    } else {
      const perTurnGrowthRate = (sector.currentGrowthRate ?? 0) / GROWTH_RATE_TURNS_PER_YEAR;
      growthCostAnchor = calculateDailyGrowthCost(
        revenueAnchor,
        perTurnGrowthRate,
        opts.growthCost.primeRate
      );
    }
  }

  return {
    revenueAnchor,
    maintenanceAnchor,
    growthCostAnchor,
    dailyProfitAnchor: revenueAnchor - maintenanceAnchor - growthCostAnchor,
  };
}

// ─── Economic scale (cost/fee bases) ────────────────────────────────────────

/**
 * A sector's ECONOMIC SCALE in its own stored units — "how big is this thing",
 * for pricing a fee against.
 *
 * Under plants `revenue` is what the market actually cleared, scaled by the ramp
 * and driven to exactly 0 by mothballing. Any COST computed as a fraction of it
 * therefore collapses to 0 for a plant that is temporarily cold — and several
 * were: unlocking a tech node and busting a union both became FREE for a corp
 * that mothballed its capacity first, then unmothballed it afterwards. The
 * capacity never left the balance sheet; only the number the fee was priced
 * against did.
 *
 * The scale is therefore `max(revenue, capacity nameplate)` under plants: the
 * nameplate is `capitalStock` priced through the sector's own strategy mix,
 * which is the figure `sectorTurn` restates `revenue` from before fill and ramp.
 * A running sector is unaffected (its revenue is at or near nameplate); a cold
 * one is priced on the plant it still owns.
 *
 * UNITS, and the reason this takes no FX rate: `revenue` is stored in the
 * sector's host-state currency, while the nameplate is computed from ₳-native
 * constants. Mixing them is only sound because callers use this for a scale-free
 * FRACTION (fee = scale × rate) in the same currency the revenue was in. Do not
 * use it as an ₳ quantity — for that, take the anchor of the result at the call
 * site exactly as you would have taken the anchor of `revenue`.
 *
 * Returns `revenue` unchanged below plants, so every caller is byte-identical
 * there.
 */
export function sectorEconomicScale(
  sector: {
    sectorType: CorporationType;
    revenue?: number | null;
    capitalStock?: number | null;
    strategyId?: string | null;
  },
  plantsEnabled: boolean,
  unitScale: number
): number {
  const revenue =
    typeof sector.revenue === "number" && Number.isFinite(sector.revenue)
      ? Math.max(0, sector.revenue)
      : 0;
  if (!plantsEnabled) return revenue;
  const stock =
    typeof sector.capitalStock === "number" && Number.isFinite(sector.capitalStock)
      ? Math.max(0, sector.capitalStock)
      : 0;
  if (!(stock > 0)) return revenue;
  const nameplate =
    stock * revenuePerCapacityUnitForStrategy(sector.sectorType, sector.strategyId, unitScale);
  return Number.isFinite(nameplate) ? Math.max(revenue, nameplate) : revenue;
}

// ─── Construction in progress (CIP) ─────────────────────────────────────────

/**
 * The capacity-build fields the P3a build path (buildCapacity command /
 * capacityEconomy) stamps on a sector doc.
 *
 * Declared HERE, structurally and optionally, rather than imported: the field
 * lands on `CorporateSector` in a parallel change, and the financial half must
 * neither block on it nor fight it for ownership of the type. Absent ⇒ 0 in
 * every consumer, which is exactly the pre-P3a balance sheet.
 *
 * CONTRACT: `constructionInProgressAnchor` is already ₳ (the field name says
 * so) — it is NOT re-converted through the sector's host currency anywhere in
 * this module.
 */
export interface SectorCapexFields {
  /** Outstanding capitalized build spend on this sector, in ₳. */
  constructionInProgressAnchor?: number | null;
}

/** Outstanding CIP for one sector, in ₳. Absent/negative/non-finite ⇒ 0. */
export function sectorConstructionInProgressAnchor(sector: SectorCapexFields): number {
  const v = sector.constructionInProgressAnchor;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Σ outstanding CIP across sectors, in ₳. */
export function sumConstructionInProgressAnchor(
  sectors: readonly SectorCapexFields[] | undefined | null
): number {
  let total = 0;
  for (const s of sectors ?? []) total += sectorConstructionInProgressAnchor(s);
  return total;
}

// ─── Book value (D11 — exits settle at book) ────────────────────────────────

/** The sector fields the book-value basis reads. */
export interface SectorBookValueInput extends SectorCapexFields {
  sectorType: CorporationType;
  capitalStock?: number | null;
  /**
   * Paid basis of the owned capacity, in ₳. See `CorporateSector.capacityBookAnchor`.
   * Absent ⇒ the list-price fallback below.
   */
  capacityBookAnchor?: number | null;
}

/**
 * The LIST-PRICE valuation of a sector's owned capacity, in ₳ — what it would
 * cost to build the same plant today, at the standing (undiscounted) price.
 *
 * This is the fallback basis, NOT the book value. It is what `capacityBookAnchor`
 * is seeded to on the flip turn, and what {@link sectorCapacityBookAnchor}
 * returns for a row that has no basis recorded.
 */
export function sectorCapacityListValueAnchor(
  sector: { sectorType: CorporationType; capitalStock?: number | null },
  year: number | null | undefined,
  unitScale: number
): number {
  const capacity =
    typeof sector.capitalStock === "number" && Number.isFinite(sector.capitalStock)
      ? Math.max(0, sector.capitalStock)
      : 0;
  // NaN for an unknown year: `capacityEraPriceIndex` treats any non-finite year
  // as "modern" rather than silently pricing the build at the earliest era.
  const pricePerUnit = capacityPricePerUnit(
    sector.sectorType,
    typeof year === "number" && Number.isFinite(year) ? year : Number.NaN,
    unitScale
  );
  return capacity * pricePerUnit;
}

/**
 * PAID BASIS of a sector's owned capacity, in ₳ — the cash actually spent to
 * acquire the capacity it still holds.
 *
 * WHY THIS IS NOT `capacity × list price` (the P5 ship-blocker). Builds are
 * charged the list price times a stack of discounts — founding 0.1×, CEO
 * acumen down to 0.5×, tech 0.7×, a cheap host state 0.6× — while every exit
 * (dissolution salvage, restructuring salvage, nationalization compensation,
 * the listing quote) read the RAW list price back. Measured: found a sector for
 * 3.0M ₳, book it at 30M ₳, restructure at the 0.85 salvage fraction, receive
 * 25.5M ₳ — 8.5× the cash spent, and salvage is CREDITED to the corp, so it is
 * money creation rather than a transfer between players. Pricing the exit off
 * what was PAID closes it for every discount, present and future, because the
 * discounts are applied before the number is ever recorded.
 *
 * LAZY FALLBACK: rows written before this field existed (and any row a world
 * grant created without a basis) have no `capacityBookAnchor`. They fall back
 * to the list value — today's exact behaviour — so nothing crashes and no
 * pre-existing sector is silently written down to zero. The turn processor
 * stamps a real basis on the sector's next plants turn, seeded from the same
 * fallback, so the fallback is transitional rather than permanent.
 */
export function sectorCapacityBookAnchor(
  sector: SectorBookValueInput,
  year: number | null | undefined,
  unitScale: number
): number {
  const stored = sector.capacityBookAnchor;
  if (typeof stored === "number" && Number.isFinite(stored) && stored >= 0) {
    return stored;
  }
  return sectorCapacityListValueAnchor(sector, year, unitScale);
}

/**
 * Book value of a sector, in ₳ (D11).
 *
 *     book = capacityBookAnchor × BOOK_DEPRECIATION_FACTOR
 *            + constructionInProgressAnchor
 *
 * `capacityBookAnchor` is the depreciated PAID basis of the owned capacity (see
 * {@link sectorCapacityBookAnchor}); the turn processor scales it down in step
 * with `capitalStock` every turn, so no extra age term is needed here — see
 * {@link BOOK_DEPRECIATION_FACTOR}. CIP is cash paid for capacity not yet
 * delivered, at the price it was actually charged.
 *
 * Both legs are therefore cash the corp really spent, which is what makes the
 * D11 claim true: a sector that is built and then immediately liquidated
 * recovers `salvageFraction × build cost` and never more. Exits cannot mint.
 *
 * Returns 0 for a sector with no capacity and no build in flight.
 */
export function sectorBookValueAnchor(
  sector: SectorBookValueInput,
  year: number | null | undefined,
  unitScale: number
): number {
  return (
    sectorCapacityBookAnchor(sector, year, unitScale) * BOOK_DEPRECIATION_FACTOR +
    sectorConstructionInProgressAnchor(sector)
  );
}

/** Σ book value across sectors, in ₳. */
export function sumSectorBookValueAnchor(
  sectors: readonly SectorBookValueInput[] | undefined | null,
  year: number | null | undefined,
  unitScale: number
): number {
  let total = 0;
  for (const s of sectors ?? []) total += sectorBookValueAnchor(s, year, unitScale);
  return total;
}
