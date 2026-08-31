import type { Db } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { queryCountryEconomyHistory, queryTradeFlowHistory } from "./history";

describe("public history queries", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    ["centralBanks", "federalBudgetSnapshots", "tradeFlowSnapshots"].forEach((name) =>
      db.collection(name)
    );
  });

  it("combines bounded monetary and fiscal history without internal budget detail", async () => {
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      countryId: "US",
      interestRateHistory: [
        { turn: 9, rate: 3.5 },
        { turn: 10, rate: 3.75 },
        { turn: 11, rate: 4 },
      ],
      inflationHistory: [
        { turn: 10, rate: 2.1 },
        { turn: 11, rate: 2.2 },
      ],
      gdpGrowthHistory: [{ turn: 11, rate: 1.8 }],
    });
    db.collectionMocks.federalBudgetSnapshots!.find.mockReturnValue(
      createAsyncIterableCursor([
        {
          fiscalYear: 1954,
          turn: 11,
          createdAt: new Date("2026-08-30T00:00:00Z"),
          budget: {
            currencyCode: "USD",
            revenue: { total: 120 },
            spending: { total: 130 },
            debt: { principal: 500 },
            surplus: -10,
            gdp: 1_000,
            debtToGdpRatio: 50,
            creditRating: "AA",
            economicFactors: { inflationRate: 2.2 },
            taxBases: { private: "do not expose" },
          },
          enactedLaws: [{ title: "Internal detail" }],
        },
      ])
    );

    const result = await queryCountryEconomyHistory(db as unknown as Db, "us", {
      fromTurn: 10,
      limit: 2,
    });

    expect(result).toMatchObject({
      found: true,
      countryId: "US",
      range: { fromTurn: 10, toTurn: null, limit: 2 },
      series: {
        primeRate: [
          { turn: 10, value: 3.75 },
          { turn: 11, value: 4 },
        ],
      },
      fiscalYears: [
        {
          fiscalYear: 1954,
          turn: 11,
          revenue: 120,
          debtPrincipal: 500,
          creditRating: "AA",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("taxBases");
    expect(JSON.stringify(result)).not.toContain("Internal detail");
  });

  it("rejects unknown country codes before reading storage", async () => {
    expect(await queryCountryEconomyHistory(db as unknown as Db, "XX")).toBeNull();
    expect(db.collectionMocks.centralBanks!.findOne).not.toHaveBeenCalled();
  });

  it("returns chronological filtered trade rollups without raw matrices or books", async () => {
    db.collectionMocks.tradeFlowSnapshots!.find.mockReturnValue(
      createAsyncIterableCursor([
        {
          turn: 21,
          updatedAt: new Date("2026-08-30T01:00:00Z"),
          world: { grossVolume: 900, clearedVolume: 800, unclearedSurplus: 100 },
          national: {
            US: {
              exports: 300,
              imports: 200,
              net: 100,
              topPartnerSurplus: { countryId: "UK", net: 80 },
            },
          },
          commodities: {
            steel: {
              worldVolume: 250,
              perCountry: { US: { exports: 120, imports: 20, net: 100, uncleared: 5 } },
              flow: { US: { UK: 120 } },
            },
          },
          books: { private: true },
        },
        {
          turn: 20,
          updatedAt: new Date("2026-08-30T00:00:00Z"),
          world: { grossVolume: 700, clearedVolume: 650, unclearedSurplus: 50 },
          national: { US: { exports: 200, imports: 150, net: 50 } },
          commodities: {
            steel: {
              worldVolume: 200,
              perCountry: { US: { exports: 80, imports: 30, net: 50, uncleared: 2 } },
              flow: { US: { UK: 80 } },
            },
          },
        },
      ])
    );

    const result = await queryTradeFlowHistory(db as unknown as Db, {
      country: "US",
      commodity: "steel",
      limit: 2,
    });

    expect(result.points.map((point) => point.turn)).toEqual([20, 21]);
    expect(result.points[1]).toMatchObject({
      country: { countryId: "US", exports: 300, imports: 200, net: 100 },
      commodity: {
        key: "steel",
        worldVolume: 250,
        country: { exports: 120, imports: 20, net: 100, uncleared: 5 },
      },
    });
    expect(JSON.stringify(result)).not.toContain("flow");
    expect(JSON.stringify(result)).not.toContain("books");
  });
});
