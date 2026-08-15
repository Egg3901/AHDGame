import { describe, it, expect } from "vitest";
import { computeSharePrices, type SharePriceInput } from "./sharePriceFormula";

/**
 * A minimal input: zero-asset corp so the price is the earnings component
 * alone, making penalty and clamping effects directly visible.
 */
const base: SharePriceInput = {
  corpId: "corp",
  liquidCapitalAnchor: 0,
  sectorNPVAnchor: 0,
  issuedBondDebt: 0,
  bondHoldingsAnchor: 0,
  normalizedEarningsAnchor: 480_000,
  bondCouponEarningsAnchor: 0,
  sectorGrowthRate: 0,
  costOfCapital: 0.08,
  totalShares: 100_000,
  ceoOwnershipFraction: 0,
  indexFundOwnershipFraction: 0,
  isPrivate: true,
  // At or below SHARE_PRICE_RATE_LIMIT_MIN_PREV the per-turn rate limiter is
  // bypassed, so assertions see the raw fundamental rather than a clamp.
  previousSharePrice: 1,
  imfBailoutActive: false,
  lastShareStructureTurn: null,
};

const price = (over: Partial<SharePriceInput>) =>
  computeSharePrices([{ ...base, ...over, corpId: "corp" }], 100).get("corp")!;

describe("bond reliance uses NET bond income (corp 484 misfire)", () => {
  it("a net debtor is priced identically to a corp with no bond exposure", () => {
    // Corp 484's shape: coupons received but MORE interest paid. Gross-coupon
    // reliance clamped its operating earnings to 0 and halved the rest; net
    // basis must leave the price exactly where a bond-free operator sits.
    const noBonds = price({});
    const netDebtor = price({
      bondCouponEarningsAnchor: 371_000,
      bondInterestExpenseAnchor: 763_000,
    });
    expect(netDebtor).toBe(noBonds);
  });

  it("a pure coupon-fund is still discounted and penalized", () => {
    // No issuer interest: the original #941 case keeps its full treatment.
    const fund = price({ bondCouponEarningsAnchor: 480_000 });
    const noBonds = price({});
    expect(fund).toBeLessThan(noBonds);
  });

  it("only the net coupon slice is treated as bond income", () => {
    // 300K coupons vs 100K interest: 200K of the 480K earnings is bond-derived.
    // Price must sit strictly between the pure-operator and pure-fund cases.
    const mixed = price({
      bondCouponEarningsAnchor: 300_000,
      bondInterestExpenseAnchor: 100_000,
    });
    expect(mixed).toBeGreaterThan(price({ bondCouponEarningsAnchor: 480_000 }));
    expect(mixed).toBeLessThanOrEqual(price({}));
  });

  it("absent interest field preserves prior behaviour exactly", () => {
    const withField = price({ bondCouponEarningsAnchor: 480_000, bondInterestExpenseAnchor: 0 });
    const withoutField = price({ bondCouponEarningsAnchor: 480_000 });
    expect(withField).toBe(withoutField);
  });
});
