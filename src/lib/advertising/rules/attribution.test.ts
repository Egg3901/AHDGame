/**
 * Rules tests: advertising attribution. Proves budget partitioning, no
 * delivery means no efficacy, partial-delivery shortfall neutrality,
 * uncovered/spot neutrality, bounded efficacy, oversubscription
 * normalization, and replay determinism.
 */
import { describe, expect, it } from "vitest";
import { AD_AGREEMENT_BUDGET_BPS } from "../types";
import { AD_MAX_COVERAGE_BONUS } from "./coverage";
import {
  aggregateContractedClaims,
  attributeBuyerSpend,
  coverFractions,
  normalizeShares,
} from "./attribution";

function baseArgs(overrides: Record<string, unknown> = {}) {
  return {
    settledSpendAnchor: 100,
    deliveryExists: true,
    agreements: [{ supplierCorpId: "supplier", allocationShareBps: 6000 }],
    coverFractionBySupplier: new Map([["supplier", 1]]),
    deliveredBySupplier: new Map([["supplier", true]]),
    overlapBySupplier: new Map([["supplier", 1]]),
    ...overrides,
  };
}

describe("attributeBuyerSpend", () => {
  it("partitions settled spend into contracted and spot", () => {
    const result = attributeBuyerSpend(baseArgs());
    expect(result.settledSpendAnchor).toBe(100);
    expect(result.contractedSpendAnchor).toBe(60);
    expect(result.spotSpendAnchor).toBe(40);
    expect(result.normalized).toBe(false);
  });

  it("pays full overlap efficacy on covered contracted spend plus neutral spot", () => {
    const result = attributeBuyerSpend(baseArgs());
    expect(result.effectiveAnchor).toBeCloseTo(60 * (1 + AD_MAX_COVERAGE_BONUS) + 40, 2);
  });

  it("yields zero efficacy when nothing was delivered", () => {
    const result = attributeBuyerSpend(baseArgs({ deliveryExists: false }));
    expect(result.effectiveAnchor).toBe(0);
    expect(result.contractedSpendAnchor).toBe(0);
    expect(result.spotSpendAnchor).toBe(0);
  });

  it("yields zero efficacy for a supplier that delivered nothing", () => {
    const result = attributeBuyerSpend(
      baseArgs({
        agreements: [{ supplierCorpId: "ghost", allocationShareBps: 10000 }],
        coverFractionBySupplier: new Map([["ghost", 0]]),
        deliveredBySupplier: new Map([["ghost", false]]),
        overlapBySupplier: new Map([["ghost", 1]]),
      })
    );
    expect(result.contractedSpendAnchor).toBe(100);
    expect(result.spotSpendAnchor).toBe(0);
    expect(result.effectiveAnchor).toBe(0);
  });

  it("treats shortfall beyond delivery as neutral, not bonused", () => {
    const result = attributeBuyerSpend(
      baseArgs({ coverFractionBySupplier: new Map([["supplier", 0.5]]) })
    );
    // 30 covered at 1.5 + 30 uncovered neutral + 40 spot neutral.
    expect(result.effectiveAnchor).toBeCloseTo(30 * 1.5 + 30 + 40, 2);
  });

  it("is neutral for uncovered states even with full delivery", () => {
    const result = attributeBuyerSpend(baseArgs({ overlapBySupplier: new Map([["supplier", 0]]) }));
    expect(result.effectiveAnchor).toBe(100);
  });

  it("values pure spot spend at neutral", () => {
    const result = attributeBuyerSpend(baseArgs({ agreements: [] }));
    expect(result.contractedSpendAnchor).toBe(0);
    expect(result.spotSpendAnchor).toBe(100);
    expect(result.effectiveAnchor).toBe(100);
  });

  it("never exceeds the bounded efficacy cap", () => {
    const result = attributeBuyerSpend(
      baseArgs({
        settledSpendAnchor: 333.33,
        agreements: [{ supplierCorpId: "supplier", allocationShareBps: 10000 }],
      })
    );
    expect(result.effectiveAnchor).toBeLessThanOrEqual(
      Math.round(333.33 * (1 + AD_MAX_COVERAGE_BONUS) * 100) / 100
    );
  });

  it("normalizes oversubscribed shares to exactly the budget", () => {
    const result = attributeBuyerSpend(
      baseArgs({
        agreements: [
          { supplierCorpId: "a", allocationShareBps: 7000 },
          { supplierCorpId: "b", allocationShareBps: 7000 },
        ],
        coverFractionBySupplier: new Map([
          ["a", 1],
          ["b", 1],
        ]),
        deliveredBySupplier: new Map([
          ["a", true],
          ["b", true],
        ]),
        overlapBySupplier: new Map([
          ["a", 0],
          ["b", 0],
        ]),
      })
    );
    expect(result.normalized).toBe(true);
    expect(result.contractedSpendAnchor).toBe(100);
    expect(result.spotSpendAnchor).toBe(0);
    const total = result.lines.reduce((sum, line) => sum + line.allocationShareBps, 0);
    expect(total).toBe(AD_AGREEMENT_BUDGET_BPS);
  });

  it("is deterministic across replays", () => {
    const args = baseArgs();
    expect(attributeBuyerSpend(args)).toEqual(attributeBuyerSpend(baseArgs()));
  });

  it("ignores hostile inputs", () => {
    expect(attributeBuyerSpend(baseArgs({ settledSpendAnchor: NaN })).effectiveAnchor).toBe(0);
    expect(attributeBuyerSpend(baseArgs({ settledSpendAnchor: -50 })).effectiveAnchor).toBe(0);
  });
});

describe("normalizeShares", () => {
  it("drops empty and zero shares", () => {
    expect(
      normalizeShares([
        { supplierCorpId: "", allocationShareBps: 5000 },
        { supplierCorpId: "a", allocationShareBps: 0 },
        { supplierCorpId: "a", allocationShareBps: 3000 },
      ])
    ).toEqual([{ supplierCorpId: "a", allocationShareBps: 3000 }]);
  });
});

describe("aggregateContractedClaims and coverFractions", () => {
  it("splits one supplier's delivery fairly across buyers", () => {
    const claims = aggregateContractedClaims([
      {
        buyerCorpId: "buyerA",
        settledSpendAnchor: 100,
        agreements: [{ supplierCorpId: "s", allocationShareBps: 10000 }],
      },
      {
        buyerCorpId: "buyerB",
        settledSpendAnchor: 100,
        agreements: [{ supplierCorpId: "s", allocationShareBps: 5000 }],
      },
    ]);
    // Claims: A=100, B=50, total 150 against 120 delivered -> 0.8 each.
    const fractions = coverFractions(claims, new Map([["s", 120]]));
    expect(fractions.get("s")).toBeCloseTo(0.8, 10);
  });

  it("is zero when the supplier delivered nothing and one when unclaimed", () => {
    const claims = aggregateContractedClaims([
      {
        buyerCorpId: "buyerA",
        settledSpendAnchor: 100,
        agreements: [{ supplierCorpId: "s", allocationShareBps: 5000 }],
      },
    ]);
    expect(coverFractions(claims, new Map()).get("s")).toBe(0);
    expect(coverFractions(new Map(), new Map()).size).toBe(0);
  });
});
