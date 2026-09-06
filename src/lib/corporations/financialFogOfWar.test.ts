import { describe, expect, it } from "vitest";
import {
  applyFogToSectorPhysicals,
  booksAreExposed,
  buildQuarterlySnapshot,
  computeFillRate,
  fillRateBand,
  getSectorPhysicalsFogFactors,
  historyTotalCostsPerTurn,
  realizedNetIncomePerTurn,
} from "@/lib/corporations/financialFogOfWar";
import type { CorporationHistory } from "@/lib/db/types";
import { ObjectId } from "mongodb";

function makeHistory(
  partial: Partial<CorporationHistory> & Pick<CorporationHistory, "totalCosts">
): CorporationHistory {
  return {
    _id: new ObjectId(),
    corporationId: new ObjectId(),
    turn: 100,
    sharePrice: 1,
    totalShares: 1,
    marketCap: 1,
    liquidCapital: 0,
    revenue: 0,
    income: 0,
    marketingStrength: 0,
    logisticsStrength: 0,
    dividendRate: 0,
    createdAt: new Date(),
    ...partial,
  };
}

describe("historyTotalCostsPerTurn", () => {
  it("adds gross bond interest to operating costs", () => {
    const history = makeHistory({
      totalCosts: 800,
      perTurnBondInterestExpense: 200,
      perTurnBondDragOnNetIncome: 0,
    });
    expect(historyTotalCostsPerTurn(history)).toBe(1000);
  });

  it("falls back to bond drag when gross interest is missing", () => {
    const history = makeHistory({
      totalCosts: 500,
      perTurnBondDragOnNetIncome: 75,
    });
    expect(historyTotalCostsPerTurn(history)).toBe(575);
  });
});

describe("realizedNetIncomePerTurn", () => {
  it("folds bond coupon income back in and nets out the interest drag", () => {
    // A bond-portfolio corp: operating result is a small loss, but coupon
    // income dominates — realized net income is solidly positive (support
    // #941 / #942, where the stored operating figure showed a phantom loss).
    const history = makeHistory({
      totalCosts: 1_000,
      income: -421_000,
      perTurnBondCouponIncome: 3_100_000,
      perTurnBondDragOnNetIncome: 40_000,
    });
    expect(realizedNetIncomePerTurn(history)).toBe(2_639_000);
  });

  it("equals the stored operating income when the corp holds no bonds", () => {
    const history = makeHistory({ totalCosts: 500, income: 250 });
    expect(realizedNetIncomePerTurn(history)).toBe(250);
  });

  it("stays negative for a genuinely loss-making corp with bond debt", () => {
    // #2996 #166 shape: no coupon, real operating loss, some interest drag —
    // must NOT be flattered into the green.
    const history = makeHistory({
      totalCosts: 500,
      income: -90_000,
      perTurnBondDragOnNetIncome: 5_000,
    });
    expect(realizedNetIncomePerTurn(history)).toBe(-95_000);
  });
});

describe("buildQuarterlySnapshot", () => {
  it("exposes total costs including bond interest for fog-of-war comparison", () => {
    const history = makeHistory({
      totalCosts: 1_000,
      perTurnBondInterestExpense: 50,
      revenue: 2_000,
    });
    const snap = buildQuarterlySnapshot(history);
    expect(snap.totalCosts).toBe(1_050);
  });

  it("reports coupon-inclusive realized net income, not the operating figure", () => {
    const history = makeHistory({
      totalCosts: 1_000,
      income: -56_300,
      perTurnBondCouponIncome: 2_200_000,
      perTurnBondDragOnNetIncome: 0,
      revenue: 2_400_000,
    });
    const snap = buildQuarterlySnapshot(history);
    expect(snap.income).toBe(2_143_700);
  });
});

describe("computeFillRate", () => {
  it("is sold over produced", () => {
    expect(computeFillRate(1_000, 750)).toBeCloseTo(0.75, 10);
  });

  it("is null when the sector produced nothing, not zero", () => {
    // A mothballed or still-building sector has NO fill rate. Returning 0 here
    // would band it "low" and read to a rival as a market that cannot sell,
    // which is the opposite of the truth (it is not offering anything).
    expect(computeFillRate(0, 0)).toBeNull();
    expect(computeFillRate(null, 10)).toBeNull();
    expect(computeFillRate(10, null)).toBeNull();
    expect(computeFillRate(Number.NaN, 10)).toBeNull();
  });

  it("clamps a sold figure above produced to 1", () => {
    // Stockpile draw-down can settle more units than were produced this turn.
    expect(computeFillRate(100, 130)).toBe(1);
  });
});

describe("fillRateBand", () => {
  it("bands on the documented boundaries, inclusive of the lower bound", () => {
    expect(fillRateBand(1)).toBe("high");
    expect(fillRateBand(0.8)).toBe("high");
    expect(fillRateBand(0.7999)).toBe("medium");
    expect(fillRateBand(0.4)).toBe("medium");
    expect(fillRateBand(0.3999)).toBe("low");
    expect(fillRateBand(0)).toBe("low");
  });

  it("passes null through", () => {
    expect(fillRateBand(null)).toBeNull();
    expect(fillRateBand(undefined)).toBeNull();
  });
});

describe("applyFogToSectorPhysicals", () => {
  const physicals = {
    capacityUnits: 10_000,
    producedUnits: 9_000,
    soldUnits: 4_500,
    constructionInProgressAnchor: 2_000_000,
  };
  const uniform = (f: number) => ({ base: f, produced: f, sold: f });

  it("perturbs capacity and CIP by the base factor (the money factor)", () => {
    // Capacity shares the money factor deliberately: revenue is capacity x mix
    // price under plants, so the two published numbers have to agree.
    const out = applyFogToSectorPhysicals(physicals, { base: 1.1, produced: 1.05, sold: 0.95 });
    expect(out.capacityUnits).toBe(11_000);
    expect(out.constructionInProgressAnchor).toBe(2_200_000);
  });

  it("perturbs produced and sold with their OWN factors", () => {
    const out = applyFogToSectorPhysicals(physicals, { base: 1.1, produced: 1.05, sold: 0.95 });
    expect(out.producedUnits).toBe(9_450);
    expect(out.soldUnits).toBe(4_275);
  });

  it("never discloses the raw fill rate to an outsider", () => {
    expect(applyFogToSectorPhysicals(physicals, uniform(0.9)).fillRate).toBeNull();
  });

  /**
   * C3 REGRESSION. This is the leak the old suite pinned OPEN: it asserted
   * `fillRate === null` three lines below a test that required produced and
   * sold to carry the SAME factor — which publishes `sold / produced` exactly,
   * i.e. the fill rate, to the last digit. Independent factors are the fix.
   */
  it("does not publish the true fill rate through the produced/sold ratio", () => {
    const factors = getSectorPhysicalsFogFactors("6650000000000000000000aa", 240);
    expect(factors.produced).not.toBe(factors.sold);
    const out = applyFogToSectorPhysicals(physicals, factors);
    const trueFill = 4_500 / 9_000;
    const publishedRatio = (out.soldUnits as number) / (out.producedUnits as number);
    expect(publishedRatio).not.toBeCloseTo(trueFill, 4);
  });

  it("draws base/produced/sold independently for every corp and quarter", () => {
    for (const turn of [12, 24, 240, 999]) {
      const f = getSectorPhysicalsFogFactors("6650000000000000000000bb", turn);
      expect(new Set([f.base, f.produced, f.sold]).size).toBe(3);
      for (const v of [f.base, f.produced, f.sold]) {
        expect(v).toBeGreaterThanOrEqual(0.9);
        expect(v).toBeLessThanOrEqual(1.1);
      }
    }
  });

  it("bands from the true figures, so the band is fog-invariant", () => {
    // sold/produced = 0.5 -> "medium" whatever the quarter's factors are.
    for (const factor of [0.9, 0.95, 1, 1.07, 1.1]) {
      expect(applyFogToSectorPhysicals(physicals, uniform(factor)).fillRateBand).toBe("medium");
    }
  });

  it("reports no band for a sector that produced nothing", () => {
    const idle = { ...physicals, producedUnits: 0, soldUnits: 0 };
    expect(applyFogToSectorPhysicals(idle, uniform(1)).fillRateBand).toBeNull();
  });

  it("passes absent fields through as null rather than fogging them to 0", () => {
    const out = applyFogToSectorPhysicals(
      {
        capacityUnits: null,
        producedUnits: null,
        soldUnits: null,
        constructionInProgressAnchor: null,
      },
      uniform(1.1)
    );
    expect(out.capacityUnits).toBeNull();
    expect(out.producedUnits).toBeNull();
    expect(out.constructionInProgressAnchor).toBeNull();
    expect(out.fillRateBand).toBeNull();
  });
});

describe("booksAreExposed", () => {
  it("is false for a corporation nobody has leaked", () => {
    expect(booksAreExposed({}, 100)).toBe(false);
  });

  it("is true while the exposure is live", () => {
    expect(booksAreExposed({ booksExposedUntilTurn: 120 }, 100)).toBe(true);
  });

  it("is true on the final turn of the exposure", () => {
    expect(booksAreExposed({ booksExposedUntilTurn: 100 }, 100)).toBe(true);
  });

  it("lapses on its own once the turn passes", () => {
    // Expressed as a turn precisely so nothing has to remember to clear it.
    expect(booksAreExposed({ booksExposedUntilTurn: 99 }, 100)).toBe(false);
  });

  it("ignores a null or non-finite value rather than exposing the books", () => {
    expect(booksAreExposed({ booksExposedUntilTurn: null }, 100)).toBe(false);
    expect(booksAreExposed({ booksExposedUntilTurn: Number.NaN }, 100)).toBe(false);
  });
});
