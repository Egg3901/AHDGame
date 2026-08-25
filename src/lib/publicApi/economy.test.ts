import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/constants/exchangeRegistry", () => ({
  getExchangeApiKey: vi.fn().mockReturnValue("nyse"),
}));

vi.mock("@/lib/db/collections/governmentFormation", () => ({
  getGovernmentFormationsCollection: vi.fn(),
}));

describe("queryCountrySummary", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    ["electedOfficials", "politicalParties", "governmentFormations"].forEach((n) =>
      db.collection(n)
    );
  });

  it("returns null for unknown country code", async () => {
    const { queryCountrySummary } = await import("./economy");
    const result = await queryCountrySummary(db as unknown as Db, "XX" as never);
    expect(result).toBeNull();
  });

  it("returns country name and governmentType for a known country", async () => {
    const { getGovernmentFormationsCollection } =
      await import("@/lib/db/collections/governmentFormation");
    vi.mocked(getGovernmentFormationsCollection).mockReturnValue({
      findOne: vi.fn().mockResolvedValue(null),
    } as never);

    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue(null);
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.electedOfficials!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryCountrySummary } = await import("./economy");
    const result = await queryCountrySummary(db as unknown as Db, "US");

    expect(result).not.toBeNull();
    expect(result!.countryId).toBe("US");
    expect(typeof result!.name).toBe("string");
    expect(typeof result!.governmentType).toBe("string");
  });
});

describe("queryCountryEconomy", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    ["centralBanks", "stockExchangeSnapshots", "federalBudget"].forEach((n) => db.collection(n));
  });

  it("returns null for unknown country", async () => {
    const { queryCountryEconomy } = await import("./economy");
    const result = await queryCountryEconomy(db as unknown as Db, "XX" as never);
    expect(result).toBeNull();
  });

  it("prefers the budget's economicFactors.inflationRate over the bank chart series", async () => {
    // `centralBanks.inflationHistory` is a per-turn COPY of the budget field
    // (interestRateSnapshot.ts), so the budget is the source. The bank value
    // here is deliberately wrong so this fails if the copy is read again.
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US",
      countryId: "US",
      inflationHistory: [{ turn: 1, rate: 9.9 }],
      interestRateHistory: [],
      gdpGrowthHistory: [],
    });
    db.collectionMocks.federalBudget!.findOne.mockResolvedValue({
      economicFactors: { inflationRate: 0.15 },
    });
    db.collectionMocks.stockExchangeSnapshots!.findOne.mockResolvedValue(null);

    const { queryCountryEconomy } = await import("./economy");
    const result = await queryCountryEconomy(db as unknown as Db, "US");

    expect(result!.inflation).toBe(0.15);
  });

  it("falls back to the bank history when the budget carries no rate", async () => {
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US",
      countryId: "US",
      inflationHistory: [{ turn: 1, rate: 2.2 }],
      interestRateHistory: [],
      gdpGrowthHistory: [],
    });
    db.collectionMocks.federalBudget!.findOne.mockResolvedValue({});
    db.collectionMocks.stockExchangeSnapshots!.findOne.mockResolvedValue(null);

    const { queryCountryEconomy } = await import("./economy");
    const result = await queryCountryEconomy(db as unknown as Db, "US");

    expect(result!.inflation).toBe(2.2);
  });

  it("returns the budget rate for a country that has no central bank", async () => {
    // BAL, BLR and UKR each hold a budget but no centralBanks document, so the
    // old bank-only read returned null while the site showed a real rate.
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue(null);
    db.collectionMocks.federalBudget!.findOne.mockResolvedValue({
      economicFactors: { inflationRate: 0.5 },
    });
    db.collectionMocks.stockExchangeSnapshots!.findOne.mockResolvedValue(null);

    const { queryCountryEconomy } = await import("./economy");
    const result = await queryCountryEconomy(db as unknown as Db, "US");

    expect(result!.inflation).toBe(0.5);
  });

  it("caps rateHistory at 12 entries", async () => {
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US",
      countryId: "US",
      primeRate: 4.5,
      chairCharacterName: "Dr. Janet",
      chairCharacterId: null,
      interestRateHistory: Array.from({ length: 20 }, (_, i) => ({ turn: i + 1, rate: 4.0 })),
      inflationHistory: Array.from({ length: 20 }, (_, i) => ({ turn: i + 1, rate: 2.0 })),
      gdpGrowthHistory: Array.from({ length: 20 }, (_, i) => ({ turn: i + 1, rate: 1.5 })),
    });
    db.collectionMocks.stockExchangeSnapshots!.findOne.mockResolvedValue(null);

    const { queryCountryEconomy } = await import("./economy");
    const result = await queryCountryEconomy(db as unknown as Db, "US");

    expect(result).not.toBeNull();
    expect(result!.rateHistory.length).toBeLessThanOrEqual(12);
    expect(result!.inflationHistory.length).toBeLessThanOrEqual(12);
    expect(result!.gdpGrowthHistory.length).toBeLessThanOrEqual(12);
  });

  it("computes totalMarketCap from snapshot listings", async () => {
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US",
      countryId: "US",
      primeRate: 5.0,
      chairCharacterName: null,
      chairCharacterId: null,
      interestRateHistory: [],
      inflationHistory: [],
      gdpGrowthHistory: [],
    });
    db.collectionMocks.stockExchangeSnapshots!.findOne.mockResolvedValue({
      _id: "nyse",
      exchangeName: "NYSE",
      listings: [
        { marketCap: 1000, priceChange1h: 1.0, priceChange24h: 2.0 },
        { marketCap: 2000, priceChange1h: 0.5, priceChange24h: -1.0 },
      ],
    });

    const { queryCountryEconomy } = await import("./economy");
    const result = await queryCountryEconomy(db as unknown as Db, "US");

    expect(result!.stockMarket.totalMarketCap).toBe(3000);
  });
});

describe("queryLegislature", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    ["electedOfficials", "politicalParties", "bills"].forEach((n) => db.collection(n));
  });

  it("returns null for unknown country", async () => {
    const { queryLegislature } = await import("./economy");
    const result = await queryLegislature(db as unknown as Db, "XX" as never);
    expect(result).toBeNull();
  });

  it("limits pendingBills and recentlyPassed to 5 each", async () => {
    db.collectionMocks.electedOfficials!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const pendingBills = Array.from({ length: 5 }, (_, i) => ({
      _id: `bill${i}`,
      title: `Pending Bill ${i}`,
      sponsorName: "Jane",
      status: "committee",
      countryId: "US",
      proposedAt: new Date("2025-01-01"),
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
    }));
    const passedBills = Array.from({ length: 5 }, (_, i) => ({
      _id: `pbill${i}`,
      title: `Passed Bill ${i}`,
      sponsorName: "Jane",
      status: "enacted",
      countryId: "US",
      enactedAt: new Date("2025-01-01"),
      votesFor: 260,
      votesAgainst: 175,
      votesAbstain: 0,
    }));

    db.collectionMocks
      .bills!.find.mockReturnValueOnce({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(pendingBills),
      } as never)
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(passedBills),
      } as never);

    const { queryLegislature } = await import("./economy");
    const result = await queryLegislature(db as unknown as Db, "US");

    expect(result).not.toBeNull();
    expect(result!.pendingBills.length).toBeLessThanOrEqual(5);
    expect(result!.recentlyPassed.length).toBeLessThanOrEqual(5);
  });
});
