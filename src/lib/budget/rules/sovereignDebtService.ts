/**
 * Sovereign debt service on the outstanding bond stock (issue #2089).
 *
 * The credit ladder in `budget/debt.ts` is a MARGINAL price: what the market
 * charges a government for new borrowing at its current debt/GDP. Outstanding
 * sovereign bonds carry the coupon fixed when they were issued. Charging the
 * whole stock at the current ladder rate repriced a country's entire debt the
 * turn its ratio crossed a band, so a seeded high-debt country (1953 UK at
 * 180% of GDP on 3% gilts) jumped straight to a 10% to 14% coupon on every
 * pound and spiralled into CCC within a few years.
 *
 * The rule here:
 * - existing debt is serviced at the coupons its bonds actually carry;
 * - any stock not yet represented by bonds is serviced at the marginal rate;
 * - an active IMF program still caps the effective rate (refs #3813).
 *
 * New issuance is priced by issuer rating in `bonds/sovereign.ts`, so a
 * deteriorating ratio is still priced, at the pace the stock rolls over.
 *
 * Pure rules module: plain data in, plain data out.
 */
import {
  sovereignBondOutstanding,
  type SovereignPrincipalBond,
} from "@/lib/bonds/sovereignPrincipal";
import { IMF_SOVEREIGN_DEFAULT_RATE } from "@/lib/sovereignDefault/constants";

/** A sovereign bond as read for coupon service: outstanding face plus its fixed coupon (percent). */
export type CouponBearingSovereignBond = SovereignPrincipalBond & { couponRate?: number | null };

export interface SovereignCouponBook {
  /** Outstanding face (haircut-adjusted) of bonds that carry a finite coupon. */
  face: number;
  /** Annual coupon owed on that face, in the same currency. */
  annualCoupon: number;
}

/** Sum outstanding face and annual coupon across one country's bonds. */
export function sovereignCouponBook(bonds: readonly CouponBearingSovereignBond[]): SovereignCouponBook {
  let face = 0;
  let annualCoupon = 0;
  for (const bond of bonds) {
    const outstanding = sovereignBondOutstanding(bond);
    const coupon = bond.couponRate;
    if (!(outstanding > 0) || typeof coupon !== "number" || !Number.isFinite(coupon)) continue;
    face += outstanding;
    annualCoupon += (outstanding * Math.max(0, coupon)) / 100;
  }
  return { face, annualCoupon };
}

/**
 * Effective annual rate (decimal) on the whole principal: bond-covered stock at
 * its locked coupons, any uncovered remainder at `marginalRate`. With no book
 * (or a zero principal) the marginal rate is returned unchanged.
 */
export function sovereignStockServiceRate(input: {
  principal: number;
  book: SovereignCouponBook | null | undefined;
  marginalRate: number;
  imfBailoutActive?: boolean;
}): number {
  const stock = Math.max(0, Number.isFinite(input.principal) ? input.principal : 0);
  const marginal = Number.isFinite(input.marginalRate) ? Math.max(0, input.marginalRate) : 0;
  const book = input.book;
  let rate = marginal;
  if (stock > 0 && book && book.face > 0) {
    const covered = Math.min(stock, book.face);
    const couponOnCovered = book.annualCoupon * (covered / book.face);
    rate = (couponOnCovered + (stock - covered) * marginal) / stock;
  }
  return input.imfBailoutActive ? Math.min(rate, IMF_SOVEREIGN_DEFAULT_RATE) : rate;
}

/** Annual debt service on the stock under {@link sovereignStockServiceRate}. */
export function sovereignStockAnnualService(input: {
  principal: number;
  book: SovereignCouponBook | null | undefined;
  marginalRate: number;
  imfBailoutActive?: boolean;
}): number {
  const stock = Math.max(0, Number.isFinite(input.principal) ? input.principal : 0);
  return stock * sovereignStockServiceRate(input);
}
