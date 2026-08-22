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
    // Ticket #1145: market = total real revenue (150k + 100k), no unowned pool.
    expect(json.totalMarket).toBe(250000);
    expect(json.totalOwnedRevenue).toBe(250000);
    expect(json.unownedRevenue).toBe(0);
    expect(json.companies[0]).toMatchObject({
      corporationName: "Defense",
      liquidCurrencyCode: "USD",
      revenue: 150000,
      revenueAnchor: 150000,
      marketSharePercent: 60,
    });
    expect(json.companies[1]).toMatchObject({
      corporationName: "Her Majesty's Arsenal",
      liquidCurrencyCode: "JPY",
      revenue: 9100000,
      revenueAnchor: 100000,
      marketSharePercent: 40,
    });
  });

  it("converts a foreign sector at ITS host rate, not the owner's (ticket #1161)", async () => {
    // corporateSectors.revenue is stored in the SECTOR's host currency. Reading
    // a Tokyo sector's yen figure at its US owner's rate treats 9.1M JPY as
    // 9.1M USD, so one foreign sector in a weak-currency country made a small
    // corp outrank a genuinely larger one.
    const usCorpId = new ObjectId();
    const rivalId = new ObjectId();

    db.collectionMocks.states = db.collection("states");
    db.collectionMocks.states.find.mockReturnValue(
      makeCursor([
        { _id: "JP-13", name: "Tokyo", gdp: 1_000_000, countryId: "JP" },
        { _id: "US-CA", name: "California", gdp: 1_000_000, countryId: "US" },
      ])
    );

    db.collectionMocks.corporateSectors = db.collection("corporateSectors");
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      makeCursor([
        // A US corp's Tokyo sector: 9.1M yen, worth 100k anchor.
        {
          _id: new ObjectId(),
          corporationId: usCorpId,
          stateId: "JP-13",
          countryId: "JP",
          sectorType: "defense",
          revenue: 9_100_000,
        },
        // A rival with a genuinely larger US book.
        {
          _id: new ObjectId(),
          corporationId: rivalId,
          stateId: "US-CA",
          countryId: "US",
          sectorType: "defense",
          revenue: 500_000,
        },
      ])
    );

    db.collectionMocks.unownedSectors = db.collection("unownedSectors");
    db.collectionMocks.unownedSectors.find.mockReturnValue(makeCursor([]));

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
          _id: usCorpId,
          name: "Bulgaria Holdings",
          sequentialId: 1,
          countryId: "US",
          liquidCurrencyCode: "USD",
        },
        {
          _id: rivalId,
          name: "Real Giant",
          sequentialId: 2,
          countryId: "US",
          liquidCurrencyCode: "USD",
        },
      ])
    );

    const request = new Request("https://example.com/api/discord-bot/marketshare?type=defense");
    const { GET } = await import("./route");
    const json = await (await GET(request)).json();

    // 100k anchor, not 9.1M: the yen figure is read at the yen rate.
    const holdings = json.companies.find(
      (c: { corporationName: string }) => c.corporationName === "Bulgaria Holdings"
    );
    expect(holdings.revenueAnchor).toBe(100_000);
    // And the genuinely larger corp ranks first, which is the reported symptom.
    expect(json.companies[0].corporationName).toBe("Real Giant");
  });
});
