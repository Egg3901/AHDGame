/**
 * State capex growth (plants tier): the bounded channel that lets a state
 * enterprise add capacity on top of the depreciation replacement it already
 * gets, but only where the market it sells into is short.
 *
 * PURE rules: plain data in, plain data out. The shell
 * (`applyStateCapexGrants` in `../soeOperations.ts`) loads sectors and prices,
 * asks the treasury to pay, and writes the build orders.
 */

import type { CorporationType } from "@/lib/db/types";

/** Weighted price-over-base ratio of a sector's outputs above which it counts as short. */
export const SOE_GROWTH_MIN_SHORTAGE = 1.25;

/**
 * Size of one growth order, as a share of the sector's current capacity. The
 * order is the only one a state sector holds (see `eligible`), so this is also
 * the growth per build cycle: roughly the pace the private reinvestment brain
 * adds in a chronic shortage, not a crash programme.
 */
export const SOE_GROWTH_ORDER_SHARE = 0.05;

/** Growth is skipped once sovereign debt is this close to its ceiling. */
export const SOE_GROWTH_MAX_DEBT_TO_CEILING = 0.9;

/** Most of a treasury's cash one turn of growth orders may commit. */
export const SOE_GROWTH_MAX_CASH_SHARE = 0.05;

/**
 * Extraction is bound by finite deposits, not by capital, so a price spike must
 * not buy a mine more capacity than the ground holds.
 */
const GROWTH_EXCLUDED_SECTORS: ReadonlySet<CorporationType> = new Set(["extraction"]);

export interface SoeGrowthSectorInput {
  id: string;
  sectorType: CorporationType;
  capitalStock: number;
  /** Outstanding build orders. Any pending order means the sector is still building. */
  pendingOrders: number;
  /** ₳ per capacity unit at the standing list price. */
  unitPriceAnchor: number;
  /** Weighted price-over-base ratio of the sector's outputs; null when unpriced. */
  shortage: number | null;
}

export interface SoeGrowthOrderPlan {
  sectorId: string;
  units: number;
  costAnchor: number;
}

export interface SoeTreasuryStanding {
  debtPrincipal: number;
  debtCeiling: number;
  /** `normal` is the only state that may fund growth. */
  crisisState: string | null | undefined;
  /** Funded treasury cash, in ₳. */
  cashAnchor: number;
}

/**
 * ₳ of growth this treasury may commit this turn: zero unless it is in good
 * standing (no sovereign crisis, debt clear of its ceiling), otherwise a small
 * share of its funded cash. The cash share is on top of the funded-cash refusal
 * the settlement itself enforces.
 */
export function soeGrowthBudgetAnchor(t: SoeTreasuryStanding): number {
  if (t.crisisState != null && t.crisisState !== "normal") return 0;
  if (!(t.debtCeiling > 0) || !Number.isFinite(t.debtPrincipal)) return 0;
  if (t.debtPrincipal >= t.debtCeiling * SOE_GROWTH_MAX_DEBT_TO_CEILING) return 0;
  if (!(t.cashAnchor > 0) || !Number.isFinite(t.cashAnchor)) return 0;
  return t.cashAnchor * SOE_GROWTH_MAX_CASH_SHARE;
}

function eligible(s: SoeGrowthSectorInput): boolean {
  return (
    !GROWTH_EXCLUDED_SECTORS.has(s.sectorType) &&
    s.pendingOrders === 0 &&
    s.capitalStock > 0 &&
    s.unitPriceAnchor > 0 &&
    Number.isFinite(s.unitPriceAnchor) &&
    s.shortage != null &&
    Number.isFinite(s.shortage) &&
    s.shortage >= SOE_GROWTH_MIN_SHORTAGE
  );
}

/**
 * Plan one treasury's growth orders: every eligible short sector gets one order
 * of {@link SOE_GROWTH_ORDER_SHARE} of its capacity, shortest-supplied first,
 * until the budget runs out. A sector is skipped whole when its order does not
 * fit, so the plan never exceeds `budgetAnchor`.
 */
export function planSoeCapexGrowth(
  sectors: readonly SoeGrowthSectorInput[],
  budgetAnchor: number
): { growthAnchor: number; orders: SoeGrowthOrderPlan[] } {
  const orders: SoeGrowthOrderPlan[] = [];
  let growthAnchor = 0;
  if (!(budgetAnchor > 0)) return { growthAnchor, orders };
  const ranked = sectors
    .filter(eligible)
    .sort((a, b) => (b.shortage ?? 0) - (a.shortage ?? 0) || a.id.localeCompare(b.id));
  for (const s of ranked) {
    const units = s.capitalStock * SOE_GROWTH_ORDER_SHARE;
    const costAnchor = units * s.unitPriceAnchor;
    if (!(costAnchor > 0) || growthAnchor + costAnchor > budgetAnchor) continue;
    orders.push({ sectorId: s.id, units, costAnchor });
    growthAnchor += costAnchor;
  }
  return { growthAnchor, orders };
}
