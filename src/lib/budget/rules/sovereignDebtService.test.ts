import { describe, expect, it } from "vitest";
import { calculateCreditRating, calculateInterestRate } from "@/lib/budget/debt";
import { IMF_SOVEREIGN_DEFAULT_RATE } from "@/lib/sovereignDefault/constants";
import {
  sovereignCouponBook,
  sovereignIssuanceRiskSpreadPp,
  sovereignRiskFreeLadderRate,
  sovereignStockAnnualService,
  sovereignStockServiceRate,
  type CouponBearingSovereignBond,
} from "./sovereignDebtService";
import { sovereignCouponBooksByCountry } from "@/lib/bonds/sovereignCouponBook";

function bond(face: number, couponPct: number, extra: Partial<CouponBearingSovereignBond> = {}) {
  return {
    issuerType: "sovereign" as const,
    matured: false,
    defaulted: false,
    totalIssued: face,
    restructureHaircutPercent: null,
    couponRate: couponPct,
    ...extra,
  };
}

describe("sovereign coupon book", () => {
  it("sums outstanding face and coupon, skipping matured, defaulted and couponless paper", () => {
    const book = sovereignCouponBook([
      bond(1_000, 3),
      bond(500, 5, { restructureHaircutPercent: 0.4 }),
      bond(9_999, 9, { matured: true }),
      bond(9_999, 9, { defaulted: true }),
      bond(9_999, Number.NaN),
      { ...bond(9_999, 9), issuerType: "corporate" as const },
    ]);
    expect(book.face).toBe(1_300);
    expect(book.annualCoupon).toBeCloseTo(30 + 300 * 0.05, 9);
  });

  it("groups loaded bonds by issuing country", () => {
    const books = sovereignCouponBooksByCountry([
      { ...bond(100, 4), countryId: "UK" },
      { ...bond(300, 2), countryId: "UK" },
      { ...bond(50, 6), countryId: "US" },
    ]);
    expect(books.get("UK")).toEqual({ face: 400, annualCoupon: 10 });
    expect(books.get("US")?.annualCoupon).toBeCloseTo(3, 9);
  });
});

describe("sovereign stock service", () => {
  it("services bond-covered stock at its locked coupons, not the marginal ladder rate", () => {
    const book = { face: 2_000, annualCoupon: 60 };
    expect(sovereignStockServiceRate({ principal: 2_000, book, marginalRate: 0.1 })).toBeCloseTo(
      0.03,
      9
    );
    expect(sovereignStockAnnualService({ principal: 2_000, book, marginalRate: 0.1 })).toBeCloseTo(
      60,
      9
    );
  });

  it("prices only the uncovered remainder at the marginal rate", () => {
    const book = { face: 1_000, annualCoupon: 30 };
    expect(sovereignStockAnnualService({ principal: 1_500, book, marginalRate: 0.1 })).toBeCloseTo(
      30 + 50,
      9
    );
  });

  it("scales the book down when principal is below the bond face", () => {
    const book = { face: 1_000, annualCoupon: 40 };
    expect(sovereignStockAnnualService({ principal: 500, book, marginalRate: 0.1 })).toBeCloseTo(
      20,
      9
    );
  });

  it("falls back to whole-stock marginal pricing without a book", () => {
    expect(
      sovereignStockAnnualService({ principal: 1_000, book: null, marginalRate: 0.07 })
    ).toBeCloseTo(70, 9);
    expect(sovereignStockAnnualService({ principal: 0, book: null, marginalRate: 0.07 })).toBe(0);
  });

  it("keeps the IMF program cap on the effective rate", () => {
    const book = { face: 1_000, annualCoupon: 140 };
    expect(
      sovereignStockServiceRate({
        principal: 1_000,
        book,
        marginalRate: 0.14,
        imfBailoutActive: true,
      })
    ).toBe(IMF_SOVEREIGN_DEFAULT_RATE);
  });
});

describe("new-issue credit-risk spread", () => {
  it("is zero for an AAA issuer at full confidence", () => {
    expect(sovereignIssuanceRiskSpreadPp({ debtToGdpRatio: 0.4, investorConfidence: 100 })).toBe(0);
  });

  it("prices the ladder premium over AAA for a distressed ratio", () => {
    const expectedPp = (calculateInterestRate(2.0) - sovereignRiskFreeLadderRate()) * 100;
    expect(sovereignIssuanceRiskSpreadPp({ debtToGdpRatio: 2.0 })).toBeCloseTo(expectedPp, 9);
    expect(expectedPp).toBeGreaterThan(0);
  });

  it("is IMF-capped while a program is active", () => {
    const capped = sovereignIssuanceRiskSpreadPp({ debtToGdpRatio: 3, imfBailoutActive: true });
    const uncapped = sovereignIssuanceRiskSpreadPp({ debtToGdpRatio: 3 });
    expect(capped).toBeLessThan(uncapped);
  });
});

/**
 * Deterministic projection of the #2089 mechanism: a 1953-style sovereign at
 * 217% of GDP on low seeded coupons, balanced primary budget, 7% nominal
 * growth. The old rule charged the whole stock the marginal ladder rate every
 * year; the new rule services each tranche at its own coupon and reprices only
 * what rolls over, at prime plus the issuer's current credit spread.
 */
describe("1953 high-debt sovereign projection (#2089)", () => {
  const GDP0 = 100;
  const RATIO0 = 2.17;
  const PRIME_PCT = 3;
  const GROWTH = 0.07;
  const YEARS = 5;

  function projectOldRule(): number[] {
    let debt = GDP0 * RATIO0;
    let gdp = GDP0;
    const ratios: number[] = [];
    for (let y = 0; y < YEARS; y++) {
      debt += debt * calculateInterestRate(debt / gdp);
      gdp *= 1 + GROWTH;
      ratios.push(debt / gdp);
    }
    return ratios;
  }

  function projectCouponBook(): number[] {
    // Seed tranches mirror the reconcile distribution: 25% 1y, 35% 2y, 40% 5y.
    type Tranche = { face: number; couponPct: number; yearsLeft: number; tenor: number };
    let gdp = GDP0;
    const stock = GDP0 * RATIO0;
    let tranches: Tranche[] = [
      { face: stock * 0.25, couponPct: PRIME_PCT, yearsLeft: 1, tenor: 1 },
      { face: stock * 0.35, couponPct: PRIME_PCT, yearsLeft: 2, tenor: 2 },
      { face: stock * 0.4, couponPct: PRIME_PCT, yearsLeft: 5, tenor: 5 },
    ];
    const ratios: number[] = [];
    for (let y = 0; y < YEARS; y++) {
      const principal = tranches.reduce((s, t) => s + t.face, 0);
      const book = sovereignCouponBook(tranches.map((t) => bond(t.face, t.couponPct)));
      const interest = sovereignStockAnnualService({
        principal,
        book,
        marginalRate: calculateInterestRate(principal / gdp),
      });
      gdp *= 1 + GROWTH;
      // Interest is deficit-financed with new 1y paper; maturing paper rolls
      // at its original tenor. Both price prime plus the current spread.
      const spread = sovereignIssuanceRiskSpreadPp({ debtToGdpRatio: principal / gdp });
      const next: Tranche[] = [];
      for (const t of tranches) {
        if (t.yearsLeft > 1) next.push({ ...t, yearsLeft: t.yearsLeft - 1 });
        else next.push({ ...t, couponPct: PRIME_PCT + spread, yearsLeft: t.tenor });
      }
      next.push({ face: interest, couponPct: PRIME_PCT + spread, yearsLeft: 1, tenor: 1 });
      tranches = next;
      ratios.push(next.reduce((s, t) => s + t.face, 0) / gdp);
    }
    return ratios;
  }

  it("the old whole-stock rule spirals toward the CCC floor every year", () => {
    const ratios = projectOldRule();
    for (let i = 1; i < ratios.length; i++) expect(ratios[i]).toBeGreaterThan(ratios[i - 1]);
    expect(ratios[ratios.length - 1]).toBeGreaterThan(2.45);
  });

  it("the coupon-book rule deleverages on growth and never reaches CCC", () => {
    const ratios = projectCouponBook();
    for (const r of ratios) expect(calculateCreditRating(r)).not.toBe("CCC");
    expect(ratios[ratios.length - 1]).toBeLessThan(RATIO0);
  });
});
