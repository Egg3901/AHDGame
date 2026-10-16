import { describe, expect, it } from "vitest";
import {
  holdingMarketSnapshotValues,
  holdingMarketValues,
  holdingMarketTotals,
  anchorHoldingPosition,
  scaleHoldingTerms,
  subtractHoldingTerms,
  holdingCostBasis,
  holdingDividendSplit,
  holdingSaleGains,
  holdingShares,
  matureHoldingTerms,
  mergeHoldingTerms,
  positionHoldingTerms,
  purchasedHoldingTerms,
  takeHoldingShares,
  takeReservedHoldingShares,
  validateHoldingTerms,
} from "./holdingTerms";
import { reconstructLegacyHoldingBasis, allocateLegacyUnknownBasis } from "./legacyHoldingBasis";

describe("holding market values", () => {
  it("preserves rounded totals when fractional quote values straddle a cent", () => {
    expect(holdingMarketSnapshotValues(0.01, 0.005)).toEqual({
      stockValue: 0.01,
      shortTermStockValue: 0.01,
      longTermStockValue: 0,
    });
    expect(() => holdingMarketSnapshotValues(1, 2)).toThrow();
  });
  it("moves value at exactly 48 turns and preserves the combined total", () => {
    const position = {
      shares: 10,
      holdingTerms: {
        longTermShares: 4,
        longTermCostBasisAnchor: 0,
        shortTermLots: [{ shares: 6, acquiredTurn: 100, costBasisAnchor: 0 }],
      },
    };
    expect(holdingMarketValues(position, 147, 5)).toEqual({
      stockValue: 50,
      shortTermStockValue: 30,
      longTermStockValue: 20,
    });
    expect(holdingMarketValues(position, 148, 5)).toEqual({
      stockValue: 50,
      shortTermStockValue: 0,
      longTermStockValue: 50,
    });
    expect(
      holdingMarketTotals([
        { position, turn: 147, anchorSharePrice: 5 },
        { position: { shares: 2 }, turn: 147, anchorSharePrice: 10 },
      ])
    ).toEqual({ stockValue: 70, shortTermStockValue: 30, longTermStockValue: 40 });
    expect(holdingMarketTotals([])).toEqual({
      stockValue: 0,
      shortTermStockValue: 0,
      longTermStockValue: 0,
    });
  });
});
describe("stock holding terms", () => {
  it("converts only unmarked legacy averages from issuer-local currency", () => {
    expect(anchorHoldingPosition({ shares: 10, avgCostPerShare: 8 }, 2)).toEqual({
      shares: 10,
      avgCostPerShare: 4,
    });
    expect(
      anchorHoldingPosition({ shares: 10, avgCostPerShare: 8, avgCostBasisUnit: "anchor" }, 2)
        .avgCostPerShare
    ).toBe(8);
    const tracked = {
      shares: 10,
      avgCostPerShare: 8,
      holdingTerms: purchasedHoldingTerms(10, 8, 1),
    };
    expect(anchorHoldingPosition(tracked, 2)).toBe(tracked);
  });
  it("conserves cost basis and acquisition age through splits and rounded consolidations", () => {
    const terms = mergeHoldingTerms(
      { longTermShares: 3, longTermCostBasisAnchor: 30, shortTermLots: [] },
      purchasedHoldingTerms(2, 7, 20),
      20
    );
    const split = scaleHoldingTerms(terms, 10, 21);
    expect(split).toEqual({
      longTermShares: 6,
      longTermCostBasisAnchor: 30,
      shortTermLots: [{ acquiredTurn: 20, shares: 4, costBasisAnchor: 14 }],
    });
    const consolidated = scaleHoldingTerms(terms, 1, 21);
    expect(holdingShares(consolidated)).toBe(1);
    expect(holdingCostBasis(consolidated)).toBe(44);
    expect(scaleHoldingTerms(terms, 10, 68)).toEqual({
      longTermShares: 10,
      longTermCostBasisAnchor: 44,
      shortTermLots: [],
    });
  });
  it("reverses the exact purchase even when another same-turn purchase has a different basis", () => {
    const prior = purchasedHoldingTerms(10, 3, 20);
    const addition = purchasedHoldingTerms(5, 11, 20);
    const total = mergeHoldingTerms(prior, addition, 20);
    expect(subtractHoldingTerms(total, addition, 20)).toEqual(prior);
    expect(subtractHoldingTerms(matureHoldingTerms(total, 68), addition, 68)).toEqual(
      matureHoldingTerms(prior, 68)
    );
  });
  it("matures at exactly 48 turns and discards purchase-turn tracking", () => {
    const bought = purchasedHoldingTerms(10, 25, 100);
    expect(matureHoldingTerms(bought, 147)).toEqual(bought);
    expect(matureHoldingTerms(bought, 148)).toEqual({
      longTermShares: 10,
      longTermCostBasisAnchor: 250,
      shortTermLots: [],
    });
    expect(matureHoldingTerms(matureHoldingTerms(bought, 148), 200)).toEqual(
      matureHoldingTerms(bought, 148)
    );
    expect(bought.shortTermLots).toHaveLength(1);
  });
  it("coalesces same-turn purchases and consumes short-term lots FIFO", () => {
    const terms = mergeHoldingTerms(
      mergeHoldingTerms(purchasedHoldingTerms(10, 2, 10), purchasedHoldingTerms(20, 3, 11), 11),
      purchasedHoldingTerms(10, 4, 10),
      11
    );
    expect(terms.shortTermLots).toEqual([
      { acquiredTurn: 10, shares: 20, costBasisAnchor: 60 },
      { acquiredTurn: 11, shares: 20, costBasisAnchor: 60 },
    ]);
    const sale = takeHoldingShares(terms, 25, "short", 12);
    expect(holdingCostBasis(sale.taken)).toBe(75);
    expect(sale.remaining.shortTermLots).toEqual([
      { acquiredTurn: 11, shares: 15, costBasisAnchor: 45 },
    ]);
  });
  it("requires sufficient shares in the selected bucket", () => {
    const terms = mergeHoldingTerms(
      purchasedHoldingTerms(10, 2, 1),
      purchasedHoldingTerms(5, 3, 48),
      49
    );
    expect(() => takeHoldingShares(terms, 6, "short", 49)).toThrow("Insufficient");
    expect(takeHoldingShares(terms, 10, "long", 49).remaining.shortTermLots).toHaveLength(1);
    expect(() => takeHoldingShares(terms, 11, "long", 49)).toThrow("Insufficient");
  });
  it("preserves escrow age and basis across partial fills and cancellation", () => {
    const escrow = mergeHoldingTerms(
      purchasedHoldingTerms(7, 3, 10),
      purchasedHoldingTerms(13, 5, 11),
      11
    );
    const fill = takeReservedHoldingShares(escrow, 10, 58);
    expect(fill.taken.longTermShares).toBe(7);
    expect(fill.taken.shortTermLots[0].shares).toBe(3);
    const restored = mergeHoldingTerms(purchasedHoldingTerms(5, 8, 59), fill.remaining, 59);
    expect(restored.longTermShares).toBe(10);
    expect(restored.longTermCostBasisAnchor).toBe(50);
    expect(holdingCostBasis(fill.taken) + holdingCostBasis(restored)).toBe(126);
  });
  it("taxes positive profits instead of principal and splits dividends by term", () => {
    const terms = mergeHoldingTerms(
      purchasedHoldingTerms(10, 10, 1),
      purchasedHoldingTerms(10, 20, 49),
      49
    );
    expect(holdingSaleGains(terms, 500, 49)).toEqual({
      incomeGainAnchor: 50,
      capitalGainAnchor: 150,
      costBasisAnchor: 300,
    });
    expect(holdingSaleGains(terms, 100, 49)).toEqual({
      incomeGainAnchor: 0,
      capitalGainAnchor: 0,
      costBasisAnchor: 300,
    });
    expect(holdingDividendSplit(terms, 101, 49)).toEqual({ income: 50.5, capital: 50.5 });
  });
  it("grandfathers untracked stock and preserves zero cost basis", () => {
    expect(positionHoldingTerms({ shares: 12, avgCostPerShare: 0 }, 100, 5)).toEqual({
      longTermShares: 12,
      longTermCostBasisAnchor: 0,
      shortTermLots: [],
    });
    expect(positionHoldingTerms({ shares: 12 }, 100, 5).longTermCostBasisAnchor).toBe(60);
  });
  it("rejects invalid inventory, costs, future purchases and mismatched state", () => {
    for (const shares of [-1, 0.5, NaN, Infinity])
      expect(() => purchasedHoldingTerms(shares, 1, 1)).toThrow();
    for (const price of [-1, NaN, Infinity])
      expect(() => purchasedHoldingTerms(1, price, 1)).toThrow();
    expect(() => matureHoldingTerms(purchasedHoldingTerms(1, 1, 2), 1)).toThrow("future");
    expect(() => validateHoldingTerms(purchasedHoldingTerms(1, 1, 1), 2)).toThrow("inventory");
  });
  it("conserves inventory and basis through repeated partial dispositions", () => {
    let terms = purchasedHoldingTerms(999, 1 / 3, 10);
    let disposedBasis = 0;
    for (let i = 0; i < 999; i++) {
      const sale = takeHoldingShares(terms, 1, "short", 11);
      disposedBasis += holdingCostBasis(sale.taken);
      terms = sale.remaining;
    }
    expect(holdingShares(terms)).toBe(0);
    expect(holdingCostBasis(terms)).toBe(0);
    expect(disposedBasis).toBeCloseTo(333, 9);
  });
});

describe("legacy cost reconstruction", () => {
  it("prefers recorded basis including a recorded zero", () => {
    for (const average of [0, 3]) {
      const result = reconstructLegacyHoldingBasis({
        shares: 10,
        recordedAverage: average,
        rolloutAnchorPrice: 99,
        events: [{ kind: "buy", shares: 10, totalAnchor: 40 }],
      });
      expect(result.source).toBe("recorded");
      expect(result.terms.longTermCostBasisAnchor).toBe(10 * average);
    }
  });
  it("reconstructs purchases and dispositions", () => {
    const result = reconstructLegacyHoldingBasis({
      shares: 15,
      rolloutAnchorPrice: 99,
      events: [
        { kind: "buy", shares: 10, totalAnchor: 20 },
        { kind: "buy", shares: 10, totalAnchor: 40 },
        { kind: "sell", shares: 5 },
      ],
    });
    expect(result.source).toBe("history");
    expect(result.terms.longTermCostBasisAnchor).toBe(45);
  });
  it("fills unknown opening shares at rollout price", () => {
    const result = reconstructLegacyHoldingBasis({
      shares: 15,
      rolloutAnchorPrice: 10,
      events: [{ kind: "buy", shares: 5, totalAnchor: 20 }],
    });
    expect(result.source).toBe("mixed");
    expect(result.fallbackShares).toBe(10);
    expect(result.terms.longTermCostBasisAnchor).toBe(120);
  });
  it("preserves total cost through a fully documented split", () => {
    expect(
      reconstructLegacyHoldingBasis({
        shares: 20,
        rolloutAnchorPrice: 99,
        events: [
          { kind: "buy", shares: 10, totalAnchor: 20 },
          { kind: "structure", beforeShares: 10, afterShares: 20 },
        ],
      }).terms.longTermCostBasisAnchor
    ).toBe(20);
  });
  it("uses rollout for ambiguous escrow while preserving authoritative recorded positions", () => {
    for (const events of [
      [{ kind: "buy" as const, shares: 5, totalAnchor: 20 }],
      [{ kind: "buy" as const, shares: 15, totalAnchor: 30 }],
    ]) {
      const basis = reconstructLegacyHoldingBasis({ shares: 15, rolloutAnchorPrice: 10, events });
      expect(
        allocateLegacyUnknownBasis({
          basis,
          shares: 15,
          unknownShares: 5,
          knownBasis: 40,
          hasKnownPosition: true,
          rolloutPrice: 10,
        })
      ).toEqual({ perShare: 10, source: "rollout", reconstructedShares: 0, fallbackShares: 5 });
    }
  });
  it("falls back when corrections or incomplete history cannot prove remaining basis", () => {
    const input = { shares: 5, rolloutAnchorPrice: 10 };
    expect(
      reconstructLegacyHoldingBasis({
        ...input,
        events: [{ kind: "buy", shares: 10, totalAnchor: 20 }],
      }).source
    ).toBe("rollout");
    expect(
      reconstructLegacyHoldingBasis({
        ...input,
        events: [{ kind: "buy", shares: 5, totalAnchor: 20 }, { kind: "unknown" }],
      }).source
    ).toBe("rollout");
  });
});
