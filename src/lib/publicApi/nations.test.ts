import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/countryAccess", () => ({ getAllCountryAccess: vi.fn() }));

describe("public nation queries", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    ["states", "countryState", "federalBudget"].forEach((name) => db.collection(name));
  });

  it("lists registered countries with runtime status and regional totals", async () => {
    const { getAllCountryAccess } = await import("@/lib/countryAccess");
    vi.mocked(getAllCountryAccess).mockResolvedValue({
      US: {
        status: "active",
        enabledForPlayers: true,
        economyPreview: false,
        registered: true,
        econOnly: false,
        nppGoverned: false,
      },
    } as never);
    db.collectionMocks.states!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { countryId: "US", population: 10, gdp: 2 },
        { countryId: "US", population: 15, gdp: 3 },
      ]),
    } as never);
    db.collectionMocks.countryState!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "US", governmentType: "parliamentary" }]),
    } as never);

    const { queryCountries } = await import("./nations");
    const result = await queryCountries(db as unknown as Db);

    expect(result.countries).toEqual([
      expect.objectContaining({
        id: "US",
        governmentType: "parliamentary",
        regionCount: 2,
        population: 25,
        gdpMillions: 5,
        currencyCode: "USD",
      }),
    ]);
  });

  it("returns full public region summaries without internal economic state", async () => {
    db.collectionMocks.states!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "CA",
          countryId: "US",
          name: "California",
          population: 40_000_000,
          workingAgePopulation: 25_000_000,
          votingEligiblePopulation: 30_000_000,
          militaryServicePopulation: 123,
          gdp: 4_000_000,
          capitalStock: 12_000_000,
          houseDistricts: 52,
          stateSenateSeats: 40,
          region: "West",
          cachedEconomicLean: -2,
          cachedSocialLean: -3,
          topSectorsCache: {
            sectors: [{ sectorType: "technology", revenue: 50, specializationBonus: null }],
          },
        },
      ]),
    } as never);

    const { queryCountryRegions } = await import("./nations");
    const result = await queryCountryRegions(db as unknown as Db, "us");

    expect(result?.regions[0]).toMatchObject({
      id: "CA",
      gdpMillions: 4_000_000,
      gdpPerCapita: 100_000,
      houseDistricts: 52,
      topSectors: [{ type: "technology", revenue: 50, specializationBonus: null }],
    });
    expect(result?.regions[0]).not.toHaveProperty("militaryServicePopulation");
    expect(result?.regions[0]).not.toHaveProperty("capitalStock");
  });

  it("derives budget balance and live GDP from authoritative fields", async () => {
    db.collectionMocks.federalBudget!.findOne.mockResolvedValue({
      _id: "federal",
      countryId: "US",
      fiscalYear: 1960,
      currencyCode: "USD",
      revenue: { total: 120, incomeTax: 70 },
      spending: { total: 100, byCategory: { healthcare: 40 }, stateGrants: 10, debtInterest: 5 },
      debt: { principal: 500, interestRate: 4, ceiling: 900 },
      gdp: 900,
      gdpSmoothed: 1000,
      debtToGdpRatio: 0.5,
      creditRating: "AAA",
      treasuryBalance: -500,
      taxRates: { incomeTax: 20 },
      economicFactors: { inflationRate: 2, gdpGrowth: 3, wageGrowth: 2, tradeGrowth: 1 },
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    db.collectionMocks.states!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ gdp: 0.001 }]),
    } as never);

    const { queryCountryBudget } = await import("./nations");
    const result = await queryCountryBudget(db as unknown as Db, "US");

    expect(result).toMatchObject({
      found: true,
      gdp: 1000,
      balance: 20,
      balancePctGdp: 2,
      debt: { principal: 500, debtToGdpRatio: 0.5, creditRating: "AAA" },
    });
  });
});
