import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireBotToken", () => ({ requireBotToken: vi.fn(() => true) }));
vi.mock("@/lib/api/rateLimit", () => ({
  BOT_FINANCIAL_LIMITS: { maxRequests: 30, windowMs: 60_000 },
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));

function makeCursor<T>(rows: T[]) {
  return {
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

describe("GET /api/discord-bot/marketshare", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("normalizes mixed-currency sector revenue before ranking and computing share", async () => {
    const jpCorpId = new ObjectId();
    const usCorpId = new ObjectId();

    db.collectionMocks.states = db.collection("states");
    db.collectionMocks.states.find.mockReturnValue(
      makeCursor([{ _id: "JP-13", name: "Tokyo", gdp: 1_000_000, countryId: "JP" }])
    );

    db.collectionMocks.corporateSectors = db.collection("corporateSectors");
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          corporationId: jpCorpId,
          stateId: "JP-13",
          sectorType: "defense",
          revenue: 9_100_000,
        },
        {
          _id: new ObjectId(),
          corporationId: usCorpId,
          stateId: "JP-13",
          sectorType: "defense",
          revenue: 150_000,
        },
      ])
    );

    db.collectionMocks.unownedSectors = db.collection("unownedSectors");
    db.collectionMocks.unownedSectors.find.mockReturnValue(
      makeCursor([
        { _id: new ObjectId(), stateId: "JP-13", sectorType: "defense", revenue: 50_000 },
      ])
    );

    db.collectionMocks.exchangeRates = db.collection("exchangeRates");
    db.collectionMocks.exchangeRates.find.mockReturnValue(
      makeCursor([
        { currencyCode: "JPY", rate: 91 },
        { currencyCode: "USD", rate: 1 },
      ])
    );

    db.collectionMocks.corporations = db.collection("corporations");
    db.collectionMocks.corporations.find.mockReturnValue(
      makeCursor([
        {
          _id: jpCorpId,
          name: "Her Majesty's Arsenal",
          sequentialId: 1,
          brandColor: "#ff00ff",
          countryId: "JP",
          liquidCurrencyCode: "JPY",
        },
        {
          _id: usCorpId,
          name: "Defense",
          sequentialId: 2,
          brandColor: "#00aaff",
          countryId: "US",
          liquidCurrencyCode: "USD",
        },
      ])
    );

    const request = new Request("https://example.com/api/discord-bot/marketshare?type=defense");
    const { GET } = await import("./route");
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.totalMarket).toBe(300000);
    expect(json.totalOwnedRevenue).toBe(250000);
    expect(json.unownedRevenue).toBe(50000);
    expect(json.companies[0]).toMatchObject({
      corporationName: "Defense",
      liquidCurrencyCode: "USD",
      revenue: 150000,
      revenueAnchor: 150000,
      marketSharePercent: 50,
    });
    expect(json.companies[1]).toMatchObject({
      corporationName: "Her Majesty's Arsenal",
      liquidCurrencyCode: "JPY",
      revenue: 9100000,
      revenueAnchor: 100000,
      marketSharePercent: 33.33,
    });
  });
});
