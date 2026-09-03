import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));
vi.mock("@/lib/sovereignDefault/snapshotLoader", () => ({
  loadCountrySovereignSnapshot: vi.fn(),
}));
vi.mock("@/lib/country/nationalGdpGrowth", () => ({ loadNationalGdpGrowth: vi.fn() }));

describe("public sovereign watch query", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    ["gameState", "federalBudget"].forEach((name) => db.collection(name));
  });

  it("publishes demand and sustainability diagnostics", async () => {
    const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
    const { loadCountrySovereignSnapshot } = await import("@/lib/sovereignDefault/snapshotLoader");
    const { loadNationalGdpGrowth } = await import("@/lib/country/nationalGdpGrowth");
    vi.mocked(getCurrentTurn).mockResolvedValue(120);
    vi.mocked(loadCountrySovereignSnapshot).mockImplementation(async (_db, country) =>
      country === "US"
        ? {
            countryCode: "US",
            currentTurn: 120,
            debtToGdp: 0.8,
            inflationRate: 0.03,
            trust: 0.7,
            sovereignCouponRate: 5,
            fxDepreciationRate10t: 0.02,
            turnsSinceLastDefault: null,
            entityHoldings: 20,
            requiredIssuance: 100,
          }
        : null
    );
    vi.mocked(loadNationalGdpGrowth).mockResolvedValue(2.5);
    db.collectionMocks.gameState!.findOne.mockResolvedValue({ currentYear: 1960 });
    db.collectionMocks.federalBudget!.findOne.mockResolvedValue({
      revenue: { total: 105 },
      spending: { total: 100 },
      gdp: 1_000,
      gdpSmoothed: 1_000,
      economicFactors: { inflationRate: 3, gdpGrowth: 2.5 },
      creditRating: "AA",
      failedAuctionConsecutiveCount: 1,
      sovereignCrisisState: "warning",
    });

    const { querySovereignWatch } = await import("./sovereigns");
    const result = await querySovereignWatch(db as unknown as Db);
    const us = result.countries.find((country) => country.countryId === "US");

    expect(us).toMatchObject({
      found: true,
      crisisState: "warning",
      creditRating: "AA",
      debtToGdpRatio: 0.8,
      inflationRate: 3,
      demand: { band: expect.any(String), components: expect.any(Array) },
      sustainability: { score: expect.any(Number), band: expect.any(String) },
    });
  });

  it("does not quote a dissolved country", async () => {
    // A merged country keeps its budget doc as a stamped husk — the public
    // watchlist must not keep reporting a dead issuer's zeroed book.
    const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
    vi.mocked(getCurrentTurn).mockResolvedValue(520);
    db.collection("countryGameStates").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "DD", dissolvedTurn: 510 }]),
    });

    const { querySovereignWatch } = await import("./sovereigns");
    const result = await querySovereignWatch(db as unknown as Db);

    expect(result.countries.some((country) => country.countryId === "DD")).toBe(false);
    expect(result.countries.some((country) => country.countryId === "US")).toBe(true);
  });
});
