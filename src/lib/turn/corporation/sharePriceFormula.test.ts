/**
 * Pure-function tests for the new three-component share-price formula.
 * No DB, no mocks — just shapes and equations.
 */
import { describe, it, expect } from "vitest";
import {
  computeSharePrices,
  bondRelianceValuationPenalty,
  rateLimitPrice,
  type SharePriceInput,
} from "./sharePriceFormula";
import { SHARE_PRICE_MAX_TURN_MOVE } from "@/lib/constants/corporations";
import {
  MIN_SHARE_PRICE,
  FUNDAMENTAL_TANGIBLE_BOOK_WEIGHT,
  FUNDAMENTAL_EARNINGS_POWER_WEIGHT,
  STOCK_SPLIT_PRICE_SMOOTHING_TURNS,
} from "@/lib/constants/corporations";

const TEST_TURN = 100;

function input(overrides: Partial<SharePriceInput>): SharePriceInput {
  return {
    corpId: "corpA",
    liquidCapitalAnchor: 0,
    sectorNPVAnchor: 0,
    issuedBondDebt: 0,
    bondHoldingsAnchor: 0,
    normalizedEarningsAnchor: 0,
    bondCouponEarningsAnchor: 0,
    sectorGrowthRate: 0,
    costOfCapital: 0.1,
    totalShares: 1_000_000,
    previousSharePrice: 1.0,
    imfBailoutActive: false,
    lastShareStructureTurn: null,
    ...overrides,
  };
}

describe("computeSharePrices — fundamental value", () => {
  it("returns at least MIN_SHARE_PRICE for a corp with zero everything", () => {
    const result = computeSharePrices([input({})], TEST_TURN);
    expect(result.get("corpA")).toBeGreaterThanOrEqual(MIN_SHARE_PRICE);
  });

  it("tangibleBook uses liquidCapital minus issuedBondDebt", () => {
    // liquidCapital=1M, debt=200k → tangibleBook=800k → tangibleBookPerShare=0.80
    // earnings=0, growth=0 → fundamentalValue = 0.25 * 0.80 = 0.20
    const r = computeSharePrices(
      [
        input({
          liquidCapitalAnchor: 1_000_000,
          issuedBondDebt: 200_000,
          normalizedEarningsAnchor: 0,
        }),
      ],
      TEST_TURN
    ).get("corpA")!;
    expect(r).toBeCloseTo(FUNDAMENTAL_TANGIBLE_BOOK_WEIGHT * (800_000 / 1_000_000), 2);
  });

  it("earnings power uses normalizedEarnings / costOfCapital / totalShares", () => {
    // earnings=100k/yr, costOfCapital=10%, shares=1M
    // earningsPowerPerShare = 100k / 0.10 / 1M = 1.00
    // growth=0, tangibleBook=0 → fundamentalValue = 0.50 * 1.00 = 0.50
    const r = computeSharePrices(
      [input({ normalizedEarningsAnchor: 100_000, costOfCapital: 0.1, liquidCapitalAnchor: 0 })],
      TEST_TURN
    ).get("corpA")!;
    expect(r).toBeCloseTo(FUNDAMENTAL_EARNINGS_POWER_WEIGHT, 2);
  });

  it("higher earnings → higher price", () => {
    const lowEarnings = computeSharePrices(
      [input({ normalizedEarningsAnchor: 50_000, costOfCapital: 0.1 })],
      TEST_TURN
    ).get("corpA")!;
    const highEarnings = computeSharePrices(
      [input({ normalizedEarningsAnchor: 200_000, costOfCapital: 0.1 })],
      TEST_TURN
    ).get("corpA")!;
    expect(highEarnings).toBeGreaterThan(lowEarnings);
  });

  it("higher prime rate (costOfCapital) → lower price, all else equal", () => {
    const lowRate = computeSharePrices(
      [input({ normalizedEarningsAnchor: 100_000, costOfCapital: 0.05 })],
      TEST_TURN
    ).get("corpA")!;
    const highRate = computeSharePrices(
      [input({ normalizedEarningsAnchor: 100_000, costOfCapital: 0.15 })],
      TEST_TURN
    ).get("corpA")!;
    expect(highRate).toBeLessThan(lowRate);
  });

  it("growth premium is positive when sectorGrowthRate > 0", () => {
    const noGrowth = computeSharePrices(
      [input({ normalizedEarningsAnchor: 100_000, sectorGrowthRate: 0, costOfCapital: 0.1 })],
      TEST_TURN
    ).get("corpA")!;
    const withGrowth = computeSharePrices(
      [input({ normalizedEarningsAnchor: 100_000, sectorGrowthRate: 0.05, costOfCapital: 0.1 })],
      TEST_TURN
    ).get("corpA")!;
    expect(withGrowth).toBeGreaterThan(noGrowth);
  });

  it("growth rate is capped at costOfCapital - GROWTH_PREMIUM_CAP_BUFFER (no blow-up)", () => {
    // sectorGrowthRate >= costOfCapital would cause division-by-zero without cap
    const r = computeSharePrices(
      [input({ normalizedEarningsAnchor: 100_000, sectorGrowthRate: 0.1, costOfCapital: 0.1 })],
      TEST_TURN
    );
    const price = r.get("corpA")!;
    expect(Number.isFinite(price)).toBe(true);
    expect(price).toBeGreaterThan(0);
  });

  it("bondHoldingsAnchor increases price (held bonds are assets)", () => {
    const noBonds = computeSharePrices(
      [input({ liquidCapitalAnchor: 50_000_000, bondHoldingsAnchor: 0 })],
      TEST_TURN
    ).get("corpA")!;
    const withBonds = computeSharePrices(
      [input({ liquidCapitalAnchor: 50_000_000, bondHoldingsAnchor: 50_000_000 })],
      TEST_TURN
    ).get("corpA")!;
    expect(withBonds).toBeGreaterThan(noBonds);
  });

  it("issuedBondDebt reduces price (debt destroys equity)", () => {
    const noDebt = computeSharePrices(
      [input({ liquidCapitalAnchor: 100_000_000, issuedBondDebt: 0 })],
      TEST_TURN
    ).get("corpA")!;
    const withDebt = computeSharePrices(
      [input({ liquidCapitalAnchor: 100_000_000, issuedBondDebt: 50_000_000 })],
      TEST_TURN
    ).get("corpA")!;
    expect(withDebt).toBeLessThan(noDebt);
  });

  it("tangibleBook floors at 0 — debt > cash does not produce negative price", () => {
    const r = computeSharePrices(
      [
        input({
          liquidCapitalAnchor: 10_000_000,
          issuedBondDebt: 50_000_000,
          normalizedEarningsAnchor: 0,
        }),
      ],
      TEST_TURN
    ).get("corpA")!;
    expect(r).toBeGreaterThanOrEqual(MIN_SHARE_PRICE);
  });

  it("rounds to 2 decimal places", () => {
    const r = computeSharePrices(
      [input({ liquidCapitalAnchor: 1_234_567, normalizedEarningsAnchor: 123_456 })],
      TEST_TURN
    ).get("corpA")!;
    expect(r).toBe(Math.round(r * 100) / 100);
  });

  it("fundamentalValue weights produce correct tangible-book-only total", () => {
    // With only tangibleBook contribution (earnings=0, growth=0):
    // fundamentalValue = TANGIBLE_BOOK_WEIGHT * tangibleBookPerShare
    const tangibleBookPerShare = 100_000_000 / 1_000_000; // $100
    const r = computeSharePrices(
      [input({ liquidCapitalAnchor: 100_000_000, normalizedEarningsAnchor: 0 })],
      TEST_TURN
    ).get("corpA")!;
    expect(r).toBeCloseTo(FUNDAMENTAL_TANGIBLE_BOOK_WEIGHT * tangibleBookPerShare, 1);
  });
});

describe("computeSharePrices — post-split smoothing", () => {
  function splitCorp(lastShareStructureTurn: number | null): SharePriceInput {
    return {
      corpId: "split-corp",
      liquidCapitalAnchor: 100_000_000,
      sectorNPVAnchor: 0,
      issuedBondDebt: 0,
      bondHoldingsAnchor: 0,
      normalizedEarningsAnchor: 0,
      bondCouponEarningsAnchor: 0,
      sectorGrowthRate: 0,
      costOfCapital: 0.1,
      totalShares: 1_000_000,
      previousSharePrice: 200, // post-split scaled price
      imfBailoutActive: false,
      lastShareStructureTurn,
    };
  }

  it("biases toward previousSharePrice during split cooldown", () => {
    const splitTurn = 50;
    const cooldownPrice = computeSharePrices([splitCorp(splitTurn)], splitTurn).get("split-corp")!;
    const noSplitPrice = computeSharePrices([splitCorp(null)], splitTurn).get("split-corp")!;
    expect(cooldownPrice).toBeGreaterThan(noSplitPrice);
  });

  it("still in cooldown at turn = lastShareStructureTurn + STOCK_SPLIT_PRICE_SMOOTHING_TURNS", () => {
    const splitTurn = 50;
    const price = computeSharePrices(
      [splitCorp(splitTurn)],
      splitTurn + STOCK_SPLIT_PRICE_SMOOTHING_TURNS
    ).get("split-corp")!;
    const noSplitPrice = computeSharePrices(
      [splitCorp(null)],
      splitTurn + STOCK_SPLIT_PRICE_SMOOTHING_TURNS
    ).get("split-corp")!;
    expect(price).toBeGreaterThan(noSplitPrice);
  });

  it("reverts to normal formula one turn after cooldown ends", () => {
    const splitTurn = 50;
    const cooldownEnd = computeSharePrices(
      [splitCorp(splitTurn)],
      splitTurn + STOCK_SPLIT_PRICE_SMOOTHING_TURNS
    ).get("split-corp")!;
    const postCooldown = computeSharePrices(
      [splitCorp(splitTurn)],
      splitTurn + STOCK_SPLIT_PRICE_SMOOTHING_TURNS + 1
    ).get("split-corp")!;
    expect(postCooldown).toBeLessThan(cooldownEnd);
  });
});

describe("computeSharePrices — bond-income interest-rate-risk adjustments", () => {
  it("values bond-coupon earnings below equivalent operating earnings (0.75x)", () => {
    // Same total normalized earnings; one all-operating, one all-bond.
    const operating = computeSharePrices(
      [
        input({
          normalizedEarningsAnchor: 100_000,
          bondCouponEarningsAnchor: 0,
          costOfCapital: 0.1,
        }),
      ],
      TEST_TURN
    ).get("corpA")!;
    const allBond = computeSharePrices(
      [
        input({
          normalizedEarningsAnchor: 100_000,
          bondCouponEarningsAnchor: 100_000,
          costOfCapital: 0.1,
        }),
      ],
      TEST_TURN
    ).get("corpA")!;
    // All-bond corp also trips the reliance ramp at 100% (extra 0.5x), so it's
    // strictly cheaper than the discount alone would imply.
    expect(allBond).toBeLessThan(operating);
    // Earnings-power contribution: operating = 0.4 * 1.00 = 0.40.
    // all-bond = 0.4 * (0.75 * 1.00) * 0.5 (reliance floor) = 0.15.
    expect(operating).toBeCloseTo(0.4, 2);
    expect(allBond).toBeCloseTo(0.15, 2);
  });

  it("haircuts bond holdings in tangible book (0.75x)", () => {
    const cashOnly = computeSharePrices([input({ liquidCapitalAnchor: 1_000_000 })], TEST_TURN).get(
      "corpA"
    )!;
    const bondsOnly = computeSharePrices([input({ bondHoldingsAnchor: 1_000_000 })], TEST_TURN).get(
      "corpA"
    )!;
    // 1M cash → 1.0/share; 1M bonds → 0.75/share after haircut.
    expect(cashOnly).toBeCloseTo(1.0, 2);
    expect(bondsOnly).toBeCloseTo(0.75, 2);
  });

  it("applies no reliance penalty at or below the 75% threshold", () => {
    // 75% bond reliance: discount applies but ramp multiplier is still 1.0.
    const r = computeSharePrices(
      [
        input({
          normalizedEarningsAnchor: 100_000,
          bondCouponEarningsAnchor: 75_000,
          costOfCapital: 0.1,
        }),
      ],
      TEST_TURN
    ).get("corpA")!;
    // earnings = 25k operating + 0.75*75k bond = 81.25k → power 0.8125 → 0.4*0.8125 = 0.325,
    // rounded to cents = 0.33.
    expect(r).toBeCloseTo(0.33, 2);
  });
});

describe("bondRelianceValuationPenalty — graduated ramp", () => {
  it("is 1.0 at and below the threshold", () => {
    expect(bondRelianceValuationPenalty(0)).toBe(1);
    expect(bondRelianceValuationPenalty(0.5)).toBe(1);
    expect(bondRelianceValuationPenalty(0.75)).toBe(1);
  });
  it("ramps linearly to the floor at 100% reliance", () => {
    expect(bondRelianceValuationPenalty(0.875)).toBeCloseTo(0.75, 5); // midpoint
    expect(bondRelianceValuationPenalty(1)).toBeCloseTo(0.5, 5);
  });
  it("never drops below the floor even past 100%", () => {
    expect(bondRelianceValuationPenalty(1.5)).toBeCloseTo(0.5, 5);
  });
});

describe("rateLimitPrice — per-turn move cap (#2888)", () => {
  it("caps an up-move at +MAX_TURN_MOVE of prev", () => {
    expect(rateLimitPrice(1000, 10)).toBeCloseTo(10 * (1 + SHARE_PRICE_MAX_TURN_MOVE), 6);
  });
  it("caps a down-move at -MAX_TURN_MOVE of prev", () => {
    expect(rateLimitPrice(0, 100)).toBeCloseTo(100 * (1 - SHARE_PRICE_MAX_TURN_MOVE), 6);
  });
  it("passes through small moves unchanged", () => {
    expect(rateLimitPrice(105, 100)).toBe(105);
  });
  it("exempts penny corps (prev <= $1) so recovery isn't pinned", () => {
    expect(rateLimitPrice(50, 1.0)).toBe(50);
    expect(rateLimitPrice(50, 0.01)).toBe(50);
  });
  it("passes non-finite through untouched", () => {
    expect(rateLimitPrice(Infinity, 100)).toBe(Infinity);
  });
});

describe("computeSharePrices — knife-edge rate limiting (#2888)", () => {
  // Corp whose fundamental collapses to ~0 because issued bond debt ≈ assets.
  function knifeEdge(previousSharePrice: number): SharePriceInput {
    return input({
      liquidCapitalAnchor: 10_000_000,
      issuedBondDebt: 500_000_000, // debt >> assets → tangible book floored at 0
      normalizedEarningsAnchor: 0,
      previousSharePrice,
    });
  }

  it("down-move at a bond-maturity knife-edge is capped, not a 200x snap", () => {
    const prev = 100;
    const price = computeSharePrices([knifeEdge(prev)], TEST_TURN).get("corpA")!;
    expect(price).toBeCloseTo(prev * (1 - SHARE_PRICE_MAX_TURN_MOVE), 2); // ~$65, not ~$0
  });

  it("up-move toward a much higher fundamental is capped", () => {
    // fundamental = 0.25 * (100M/1M) = $25, but prev is $10 → capped at $13.50
    const prev = 10;
    const price = computeSharePrices(
      [input({ liquidCapitalAnchor: 100_000_000, previousSharePrice: prev })],
      TEST_TURN
    ).get("corpA")!;
    expect(price).toBeCloseTo(prev * (1 + SHARE_PRICE_MAX_TURN_MOVE), 2);
  });

  it("penny corp (prev <= $1) is exempt and can climb fast", () => {
    // fundamental $25; prev $1 → NOT clamped to $1.35
    const price = computeSharePrices(
      [input({ liquidCapitalAnchor: 100_000_000, previousSharePrice: 1.0 })],
      TEST_TURN
    ).get("corpA")!;
    expect(price).toBeGreaterThan(2);
  });

  it("converges to the true (near-zero) fundamental over several turns", () => {
    let prev = 100;
    const prices: number[] = [];
    for (let t = 0; t < 20; t++) {
      prev = computeSharePrices([knifeEdge(prev)], TEST_TURN).get("corpA")!;
      prices.push(prev);
    }
    // Monotonically falling and eventually near the floor.
    expect(prices[1]).toBeLessThan(prices[0]);
    expect(prices[prices.length - 1]).toBeLessThan(1);
  });
});

describe("computeSharePrices — IMF bailout", () => {
  it("applies IMF_BAILOUT_SHARE_PRICE_MULTIPLIER when active", () => {
    const normal = computeSharePrices(
      [
        input({
          liquidCapitalAnchor: 100_000_000,
          normalizedEarningsAnchor: 1_000_000,
          imfBailoutActive: false,
        }),
      ],
      TEST_TURN
    ).get("corpA")!;
    const bailout = computeSharePrices(
      [
        input({
          liquidCapitalAnchor: 100_000_000,
          normalizedEarningsAnchor: 1_000_000,
          imfBailoutActive: true,
        }),
      ],
      TEST_TURN
    ).get("corpA")!;
    expect(bailout).toBeLessThan(normal);
  });
});

describe("computeSharePrices — construction in progress (P3a)", () => {
  it("counts capitalized build spend in tangible book instead of reading as a hole", () => {
    // A corp that just moved ₳10m of cash into a half-built plant must be worth
    // the same as one still holding the cash — the capex is a reclass, not a loss.
    const holdingCash = computeSharePrices(
      [input({ liquidCapitalAnchor: 10_000_000, previousSharePrice: 0.5 })],
      TEST_TURN
    ).get("corpA");
    const midBuild = computeSharePrices(
      [
        input({
          liquidCapitalAnchor: 0,
          constructionInProgressAnchor: 10_000_000,
          previousSharePrice: 0.5,
        }),
      ],
      TEST_TURN
    ).get("corpA");
    expect(midBuild).toBe(holdingCash);

    // ...and strictly better than the pre-fix behaviour (cash gone, no asset).
    const preFix = computeSharePrices(
      [input({ liquidCapitalAnchor: 0, previousSharePrice: 0.5 })],
      TEST_TURN
    ).get("corpA");
    // (previousSharePrice <= SHARE_PRICE_RATE_LIMIT_MIN_PREV, so the per-turn
    // move limiter is out of the way and the fundamentals are compared raw.)
    expect(midBuild!).toBeGreaterThan(preFix!);
  });

  it("is a no-op when the field is absent (every pre-P3a corp)", () => {
    const withField = computeSharePrices(
      [input({ liquidCapitalAnchor: 5_000_000, constructionInProgressAnchor: 0 })],
      TEST_TURN
    ).get("corpA");
    const without = computeSharePrices([input({ liquidCapitalAnchor: 5_000_000 })], TEST_TURN).get(
      "corpA"
    );
    expect(withField).toBe(without);
  });

  it("ignores a negative CIP rather than eating equity", () => {
    const negative = computeSharePrices(
      [input({ liquidCapitalAnchor: 5_000_000, constructionInProgressAnchor: -1_000_000 })],
      TEST_TURN
    ).get("corpA");
    const clean = computeSharePrices([input({ liquidCapitalAnchor: 5_000_000 })], TEST_TURN).get(
      "corpA"
    );
    expect(negative).toBe(clean);
  });

  it("pays NO growth premium at g = 0 — the plants-mode neutral value", () => {
    // recomputeSharePrices substitutes sectorGrowthRate = 0 under plants so a
    // frozen growth slider cannot buy a permanent unearned Gordon premium.
    const withGrowth = computeSharePrices(
      [input({ normalizedEarningsAnchor: 1_000_000, sectorGrowthRate: 0.05 })],
      TEST_TURN
    ).get("corpA");
    const neutral = computeSharePrices(
      [input({ normalizedEarningsAnchor: 1_000_000, sectorGrowthRate: 0 })],
      TEST_TURN
    ).get("corpA");
    expect(neutral!).toBeLessThan(withGrowth!);
    // Component 3 contributes exactly zero, so the price is book + earnings only.
    const earningsOnly = computeSharePrices(
      [input({ normalizedEarningsAnchor: 1_000_000, sectorGrowthRate: -1 })],
      TEST_TURN
    ).get("corpA");
    expect(neutral).toBe(earningsOnly);
  });
});
