import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

function mockFind(collection: string, docs: unknown[]) {
  db.collectionMocks[collection]!.find.mockReturnValue({
    toArray: async () => docs,
    project: vi.fn().mockReturnValue({ toArray: async () => docs }),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  [
    "states",
    "macroMetrics",
    "centralBanks",
    "federalBudget",
    "gameState",
    "gameConfig",
    "exchangeRates",
    "stockExchangeSnapshots",
    "corporateSectors",
    "unownedSectors",
    "corporations",
  ].forEach((n) => db.collection(n));
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  db.collectionMocks.gameState.findOne.mockResolvedValue({
    _id: "current",
    currentTurn: 412,
    currentYear: 2019,
  });
  db.collectionMocks.gameConfig.findOne.mockResolvedValue({
    _id: "default",
    commandEconomyEnabled: false,
  });
  db.collectionMocks.centralBanks.findOne.mockResolvedValue({
    _id: "US",
    countryId: "US",
    primeRate: 4.25,
    lastRateChangeTurn: 406,
    chairCharacterName: "J. Whitmore",
    gdpGrowthHistory: [
      { turn: 411, rate: 2.0 },
      { turn: 412, rate: 1.9 },
    ],
    inflationHistory: [
      { turn: 411, rate: 3.2 },
      { turn: 412, rate: 3.4 },
    ],
    interestRateHistory: [
      { turn: 411, rate: 4.25 },
      { turn: 412, rate: 4.25 },
    ],
  });
  db.collectionMocks.federalBudget.findOne.mockResolvedValue({
    _id: "federal",
    gdp: 28_000_000_000_000,
    // The displayed deficit is DERIVED from these two totals, not read from the
    // stored `surplus` cache (see lib/budget/federalSurplus). `surplus` is left
    // deliberately wrong here so the test fails if anything reads it again.
    revenue: { total: 4_200_000_000_000 },
    spending: { total: 5_000_000_000_000 },
    surplus: 999_999,
    debtToGdpRatio: 62,
    creditRating: "AA",
    economicFactors: {
      inflationRate: 3.4,
      wageGrowth: 1.8,
      tradeGrowth: -0.4,
      gdpGrowth: 1.9,
      householdPriceIndex: 1.25,
    },
  });
  mockFind("states", [
    { _id: "CA", countryId: "US", name: "California", gdp: 1_000_000, population: 30 },
    { _id: "TX", countryId: "US", name: "Texas", gdp: 820_000, population: 10 },
  ]);
  mockFind("macroMetrics", [
    {
      _id: "CA",
      economic: {
        unemploymentRate: { value: 4.5, trend: -0.2 },
        medianIncome: { value: 70_000, trend: 1.0 },
      },
    },
    {
      _id: "TX",
      economic: {
        unemploymentRate: { value: 5.0, trend: 0.1 },
        medianIncome: { value: 62_000, trend: 2.0 },
      },
    },
  ]);
  mockFind("exchangeRates", [{ _id: "US", currencyCode: "USD", rate: 1.042 }]);
  db.collectionMocks.exchangeRates.findOne.mockResolvedValue({
    _id: "US",
    currencyCode: "USD",
    rate: 1.042,
  });
  db.collectionMocks.stockExchangeSnapshots.findOne.mockResolvedValue({
    _id: "nyse",
    exchangeName: "NYSE",
    listings: [{ marketCap: 2_000_000_000_000 }, { marketCap: 2_200_000_000_000 }],
  });
  mockFind("corporateSectors", []);
  mockFind("unownedSectors", []);
  mockFind("corporations", []);
});

describe("buildCountryEconomyOutlook", () => {
  it("assembles the pulse strip from central bank + budget + state aggregates", async () => {
    const { buildCountryEconomyOutlook } = await import("./countryEconomyOutlook");
    const result = await buildCountryEconomyOutlook(db as unknown as Db, "US");

    expect(result.currentTurn).toBe(412);
    expect(result.currencyCode).toBe("USD");
    expect(result.pulse.gdpMillions).toBe(1_820_000);
    expect(result.pulse.gdpGrowth.value).toBe(1.9);
    expect(result.pulse.gdpGrowth.history.length).toBe(2);
    expect(result.pulse.inflation.value).toBe(3.4);
    expect(result.pulse.inflation.target).toBe(2);
    expect(result.pulse.primeRate.value).toBe(4.25);
    expect(result.pulse.primeRate.heldTurns).toBe(6);
    expect(result.pulse.primeRate.neutral).toBe(3);
    expect(result.pulse.credit.rating).toBe("AA");
    expect(result.pulse.credit.debtToGdpRatio).toBe(62);
    expect(result.plannedEconomy).toBeNull();
    expect(result.commandEconomyEnabled).toBe(false);
    expect(result.currentYear).toBe(2019);
  });

  it("pop-weights unemployment and median income with their trends", async () => {
    const { buildCountryEconomyOutlook } = await import("./countryEconomyOutlook");
    const result = await buildCountryEconomyOutlook(db as unknown as Db, "US");

    // (4.5×30 + 5.0×10) / 40 = 4.63 ; trend (−0.2×30 + 0.1×10) / 40 = −0.125 → −0.12 (2dp)
    expect(result.realEconomy.unemployment.value).toBeCloseTo(4.63, 2);
    expect(result.realEconomy.unemployment.trend).toBe(-0.12);
    expect(result.realEconomy.medianIncome.value).toBeCloseTo(68_000, 0);
    expect(result.realEconomy.householdPriceIndex).toBe(1.25);
    expect(result.realEconomy.realMedianIncome).toBeCloseTo(54_400, 0);
    expect(result.realEconomy.wageGrowth).toBe(1.8);
    expect(result.realEconomy.tradeGrowth).toBe(-0.4);
  });

  it("collects market handoff stats (exchange cap, forex rate, chair, deficit)", async () => {
    const { buildCountryEconomyOutlook } = await import("./countryEconomyOutlook");
    const result = await buildCountryEconomyOutlook(db as unknown as Db, "US");

    expect(result.markets.stockMarketCap).toBe(4_200_000_000_000);
    expect(result.markets.exchangeName).toBe("NYSE");
    expect(result.markets.forexRate).toBe(1.042);
    expect(result.markets.chairName).toBe("J. Whitmore");
    expect(result.markets.surplus).toBe(-800_000_000_000);
    expect(result.sectorMix.length).toBeGreaterThan(0);
  });

  it("degrades to nulls when the central bank and budget are missing", async () => {
    db.collectionMocks.centralBanks.findOne.mockResolvedValue(null);
    db.collectionMocks.federalBudget.findOne.mockResolvedValue(null);
    db.collectionMocks.stockExchangeSnapshots.findOne.mockResolvedValue(null);
    db.collectionMocks.exchangeRates.findOne.mockResolvedValue(null);

    const { buildCountryEconomyOutlook } = await import("./countryEconomyOutlook");
    const result = await buildCountryEconomyOutlook(db as unknown as Db, "US");

    expect(result.pulse.gdpGrowth.value).toBeNull();
    expect(result.pulse.inflation.value).toBeNull();
    expect(result.pulse.primeRate.value).toBeNull();
    expect(result.pulse.primeRate.heldTurns).toBeNull();
    expect(result.pulse.credit.rating).toBeNull();
    expect(result.realEconomy.householdPriceIndex).toBe(1);
    expect(result.realEconomy.realMedianIncome).toBeCloseTo(68_000, 0);
    expect(result.markets.stockMarketCap).toBeNull();
    expect(result.markets.forexRate).toBeNull();
    // GDP still aggregates from states; sector mix still returns the full board.
    expect(result.pulse.gdpMillions).toBe(1_820_000);
    expect(result.sectorMix.length).toBeGreaterThan(0);
  });
});
