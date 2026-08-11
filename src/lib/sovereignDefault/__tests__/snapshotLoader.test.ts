import { describe, it, expect, vi } from "vitest";
import { loadCountrySovereignSnapshot } from "../snapshotLoader";

describe("loadCountrySovereignSnapshot", () => {
  it("returns null when federalBudget for the country is not found", async () => {
    const fakeDb = makeFakeDb({
      federalBudget: [],
      centralBanks: [],
      exchangeRates: [],
      politicalMetrics: [],
    });
    const result = await loadCountrySovereignSnapshot(fakeDb as never, "ZZ", 100);
    expect(result).toBeNull();
  });

  it("populates entityHoldings and requiredIssuance fields (zero when no bonds and balanced budget)", async () => {
    const fakeDb = makeFakeDb({
      federalBudget: [
        {
          _id: "federal",
          countryId: "US",
          debtToGdpRatio: 1.0,
          economicFactors: { inflationRate: 2 },
          creditRating: "AAA",
          lastDefaultTurn: null,
          surplus: 0,
        },
      ],
      centralBanks: [{ _id: "US", primeRate: 4 }],
      exchangeRates: [],
      politicalMetrics: [],
    });
    const result = await loadCountrySovereignSnapshot(fakeDb as never, "US", 100);
    expect(result).not.toBeNull();
    expect(result!.entityHoldings).toBe(0);
    expect(result!.requiredIssuance).toBe(0);
  });

  it("phase 11a: discounts sovereignCouponRate by 0.5pp while recovery credibility bonus is active", async () => {
    const fakeDb = makeFakeDb({
      federalBudget: [
        {
          _id: "federal",
          countryId: "US",
          debtToGdpRatio: 1.0,
          economicFactors: { inflationRate: 2 },
          creditRating: "AA",
          lastDefaultTurn: 50,
          recoveryCredibilityBonusUntilTurn: 200, // > currentTurn (100)
        },
      ],
      centralBanks: [{ _id: "US", primeRate: 4.5 }],
      exchangeRates: [],
      politicalMetrics: [],
    });
    const result = await loadCountrySovereignSnapshot(fakeDb as never, "US", 100);
    // Without bonus: 4.5 + 0.5 (AA spread) = 5.0. With bonus: 5.0 - 0.5 = 4.5
    expect(result!.sovereignCouponRate).toBeCloseTo(4.5);
  });

  it("phase 11a: does NOT discount when bonus is expired (untilTurn <= currentTurn)", async () => {
    const fakeDb = makeFakeDb({
      federalBudget: [
        {
          _id: "federal",
          countryId: "US",
          debtToGdpRatio: 1.0,
          economicFactors: { inflationRate: 2 },
          creditRating: "AA",
          lastDefaultTurn: 50,
          recoveryCredibilityBonusUntilTurn: 100, // == currentTurn
        },
      ],
      centralBanks: [{ _id: "US", primeRate: 4.5 }],
      exchangeRates: [],
      politicalMetrics: [],
    });
    const result = await loadCountrySovereignSnapshot(fakeDb as never, "US", 100);
    expect(result!.sovereignCouponRate).toBeCloseTo(5.0); // no discount
  });

  it("returns a populated snapshot when all data is present", async () => {
    const fakeDb = makeFakeDb({
      federalBudget: [
        {
          _id: "federal",
          countryId: "US",
          debtToGdpRatio: 1.2,
          economicFactors: { inflationRate: 3 },
          creditRating: "AA",
          lastDefaultTurn: null,
        },
      ],
      centralBanks: [{ _id: "US", primeRate: 4.5 }],
      exchangeRates: [],
      politicalMetrics: [
        { countryId: "US", values: { "governance.integrity": 60 } },
        { countryId: "US", values: { "governance.integrity": 50 } },
      ],
    });
    const result = await loadCountrySovereignSnapshot(fakeDb as never, "US", 100);
    expect(result).not.toBeNull();
    expect(result!.debtToGdp).toBeCloseTo(1.2);
    expect(result!.inflationRate).toBeCloseTo(0.03);
    expect(result!.trust).toBeCloseTo(0.55); // (60+50)/2 / 100
    expect(result!.sovereignCouponRate).toBeCloseTo(5.0); // 4.5 + 0.5 (AA spread)
    expect(result!.turnsSinceLastDefault).toBeNull();
  });
});

describe("loadCountrySovereignSnapshot — federalBudget _id legacy mapping", () => {
  it("US uses _id: 'federal' (legacy)", async () => {
    const fakeDb = makeFakeDb({
      federalBudget: [
        {
          _id: "federal",
          countryId: "US",
          debtToGdpRatio: 1.0,
          economicFactors: { inflationRate: 2 },
          creditRating: "AAA",
          lastDefaultTurn: null,
        },
      ],
      centralBanks: [{ _id: "US", primeRate: 4 }],
      exchangeRates: [],
      politicalMetrics: [],
    });
    const result = await loadCountrySovereignSnapshot(fakeDb as never, "US", 100);
    expect(result).not.toBeNull();
    expect(result!.debtToGdp).toBeCloseTo(1.0);
  });

  it("returns null for US when federalBudget _id is mistakenly 'US' instead of 'federal'", async () => {
    // This guards the legacy mapping. If `federalBudgets._id === "US"` is ever
    // introduced for the US row, the lookup at `_id: "federal"` returns null
    // and the loader correctly reports the country as missing — preferable to
    // silently hitting the wrong row.
    const fakeDb = makeFakeDb({
      federalBudget: [
        {
          _id: "US",
          countryId: "US",
          debtToGdpRatio: 1.0,
          economicFactors: { inflationRate: 2 },
          creditRating: "AAA",
          lastDefaultTurn: null,
        },
      ],
      centralBanks: [{ _id: "US", primeRate: 4 }],
      exchangeRates: [],
      politicalMetrics: [],
    });
    const result = await loadCountrySovereignSnapshot(fakeDb as never, "US", 100);
    expect(result).toBeNull();
  });

  it("non-US countries use _id: countryCode", async () => {
    const fakeDb = makeFakeDb({
      federalBudget: [
        {
          _id: "UK",
          countryId: "UK",
          debtToGdpRatio: 0.95,
          economicFactors: { inflationRate: 2.5 },
          creditRating: "AA",
          lastDefaultTurn: null,
        },
      ],
      centralBanks: [{ _id: "UK", primeRate: 4.5 }],
      exchangeRates: [],
      politicalMetrics: [],
    });
    const result = await loadCountrySovereignSnapshot(fakeDb as never, "UK", 100);
    expect(result).not.toBeNull();
    expect(result!.debtToGdp).toBeCloseTo(0.95);
  });
});

describe("loadCountrySovereignSnapshot — edge cases", () => {
  it("handles missing centralBank by defaulting coupon rate to 0", async () => {
    const fakeDb = makeFakeDb({
      federalBudget: [
        {
          _id: "federal",
          countryId: "US",
          debtToGdpRatio: 1.2,
          economicFactors: { inflationRate: 3 },
          creditRating: "AA",
          lastDefaultTurn: null,
        },
      ],
      centralBanks: [],
      exchangeRates: [],
      politicalMetrics: [],
    });
    const result = await loadCountrySovereignSnapshot(fakeDb as never, "US", 100);
    expect(result?.sovereignCouponRate).toBe(0);
  });

  it("handles a country with no board by defaulting trust to 0.5 (neutral)", async () => {
    const fakeDb = makeFakeDb({
      federalBudget: [
        {
          _id: "federal",
          countryId: "US",
          debtToGdpRatio: 1.0,
          economicFactors: { inflationRate: 2 },
          creditRating: "AAA",
          lastDefaultTurn: null,
        },
      ],
      centralBanks: [{ _id: "US", primeRate: 4 }],
      exchangeRates: [],
      politicalMetrics: [],
    });
    const result = await loadCountrySovereignSnapshot(fakeDb as never, "US", 100);
    expect(result?.trust).toBe(0.5);
  });

  it("normalizes trust correctly: average of 70 and 30 → 0.5", async () => {
    const fakeDb = makeFakeDb({
      federalBudget: [
        {
          _id: "federal",
          countryId: "US",
          debtToGdpRatio: 1.0,
          economicFactors: { inflationRate: 2 },
          creditRating: "AAA",
          lastDefaultTurn: null,
        },
      ],
      centralBanks: [{ _id: "US", primeRate: 4 }],
      exchangeRates: [],
      politicalMetrics: [
        { countryId: "US", values: { "governance.integrity": 70 } },
        { countryId: "US", values: { "governance.integrity": 30 } },
      ],
    });
    const result = await loadCountrySovereignSnapshot(fakeDb as never, "US", 100);
    expect(result?.trust).toBeCloseTo(0.5);
  });

  it("clamps trust to [0, 1] even if raw values exceed expected scale", async () => {
    const fakeDb = makeFakeDb({
      federalBudget: [
        {
          _id: "federal",
          countryId: "US",
          debtToGdpRatio: 1.0,
          economicFactors: { inflationRate: 2 },
          creditRating: "AAA",
          lastDefaultTurn: null,
        },
      ],
      centralBanks: [{ _id: "US", primeRate: 4 }],
      exchangeRates: [],
      politicalMetrics: [{ countryId: "US", values: { "governance.integrity": 150 } }],
    });
    const result = await loadCountrySovereignSnapshot(fakeDb as never, "US", 100);
    expect(result?.trust).toBeLessThanOrEqual(1);
    expect(result?.trust).toBeGreaterThanOrEqual(0);
  });

  it("computes turnsSinceLastDefault correctly when lastDefaultTurn is set", async () => {
    const fakeDb = makeFakeDb({
      federalBudget: [
        {
          _id: "federal",
          countryId: "US",
          debtToGdpRatio: 1.0,
          economicFactors: { inflationRate: 2 },
          creditRating: "AAA",
          lastDefaultTurn: 950,
        },
      ],
      centralBanks: [{ _id: "US", primeRate: 4 }],
      exchangeRates: [],
      politicalMetrics: [],
    });
    const result = await loadCountrySovereignSnapshot(fakeDb as never, "US", 1000);
    expect(result?.turnsSinceLastDefault).toBe(50);
  });

  it("returns 0 fxDepreciationRate10t when exchangeRate has no rateHistory", async () => {
    const fakeDb = makeFakeDb({
      federalBudget: [
        {
          _id: "federal",
          countryId: "US",
          debtToGdpRatio: 1.0,
          economicFactors: { inflationRate: 2 },
          creditRating: "AAA",
          lastDefaultTurn: null,
        },
      ],
      centralBanks: [{ _id: "US", primeRate: 4 }],
      exchangeRates: [{ _id: "US", rate: 1.0, rateHistory: [] }],
      politicalMetrics: [],
    });
    const result = await loadCountrySovereignSnapshot(fakeDb as never, "US", 100);
    expect(result?.fxDepreciationRate10t).toBe(0);
  });

  it("computes 20% FX depreciation when rate moved from 1.0 ten turns ago to 1.2 now", async () => {
    const fakeDb = makeFakeDb({
      federalBudget: [
        {
          _id: "federal",
          countryId: "US",
          debtToGdpRatio: 1.0,
          economicFactors: { inflationRate: 2 },
          creditRating: "AAA",
          lastDefaultTurn: null,
        },
      ],
      centralBanks: [{ _id: "US", primeRate: 4 }],
      exchangeRates: [
        {
          _id: "US",
          rate: 1.2,
          rateHistory: [
            { turn: 90, rate: 1.0 },
            { turn: 95, rate: 1.05 },
          ],
        },
      ],
      politicalMetrics: [],
    });
    const result = await loadCountrySovereignSnapshot(fakeDb as never, "US", 100);
    expect(result?.fxDepreciationRate10t).toBeCloseTo(0.2);
  });

  it("returns 0 (not negative) when currency appreciated (rate dropped)", async () => {
    const fakeDb = makeFakeDb({
      federalBudget: [
        {
          _id: "federal",
          countryId: "US",
          debtToGdpRatio: 1.0,
          economicFactors: { inflationRate: 2 },
          creditRating: "AAA",
          lastDefaultTurn: null,
        },
      ],
      centralBanks: [{ _id: "US", primeRate: 4 }],
      exchangeRates: [
        {
          _id: "US",
          rate: 0.9,
          rateHistory: [{ turn: 90, rate: 1.0 }],
        },
      ],
      politicalMetrics: [],
    });
    const result = await loadCountrySovereignSnapshot(fakeDb as never, "US", 100);
    expect(result?.fxDepreciationRate10t).toBe(0);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────
type FakeData = {
  federalBudget: unknown[];
  centralBanks: unknown[];
  exchangeRates: unknown[];
  politicalMetrics: unknown[];
};

function makeFakeDb(data: FakeData) {
  return {
    collection: (name: string) => ({
      findOne: vi.fn(async (query: { _id?: string; countryId?: string }) => {
        const collection = (data as Record<string, unknown[]>)[name] ?? [];
        return (
          collection.find(
            (doc) =>
              (query._id !== undefined && (doc as Record<string, unknown>)._id === query._id) ||
              (query.countryId !== undefined &&
                (doc as Record<string, unknown>).countryId === query.countryId)
          ) ?? null
        );
      }),
      find: vi.fn((query: { countryId?: string }) => ({
        toArray: async () => {
          const collection = (data as Record<string, unknown[]>)[name] ?? [];
          if (query.countryId === undefined) return collection;
          return collection.filter(
            (doc) => (doc as Record<string, unknown>).countryId === query.countryId
          );
        },
      })),
    }),
  };
}
