import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireBotToken", () => ({ requireBotToken: vi.fn(() => true) }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
  BOT_FINANCIAL_LIMITS: { maxRequests: 20, windowMs: 60_000 },
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn(async () => new Map()),
  fxRateForCorpFromMap: vi.fn(() => 1),
  corpLiquidCapitalToAnchor: vi.fn((amount: number) => amount),
}));

describe("POST /api/discord-bot/sync-roles query budget", () => {
  let db: MockDb;
  const userId = new ObjectId();
  const characterId = new ObjectId();

  beforeEach(async () => {
    db = createMockDb();
    for (const collection of [
      "users",
      "characters",
      "corporations",
      "exchangeRates",
      "centralBanks",
      "electedOfficials",
      "countryState",
      "governmentFormations",
      "parliamentaryGovernments",
    ]) {
      db.collection(collection);
    }

    db.collectionMocks.users.find.mockReturnValue({
      project() {
        return this;
      },
      toArray: async () => [{ _id: userId, discordId: "discord-linked" }],
    });
    db.collectionMocks.characters.find.mockReturnValue({
      project() {
        return this;
      },
      toArray: async () => [
        {
          _id: characterId,
          userId,
          name: "Test Character",
          countryId: "US",
          party: "independent",
        },
      ],
    });
    db.collectionMocks.corporations.find.mockReturnValue({
      project() {
        return this;
      },
      toArray: async () => [],
    });
    db.collectionMocks.centralBanks.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.electedOfficials.find.mockReturnValue({
      project() {
        return this;
      },
      toArray: async () => [],
    });
    db.collectionMocks.countryState.find.mockReturnValue({
      toArray: async () =>
        COUNTRY_ORDER.map((countryId) => ({
          _id: countryId,
          countryId,
          governmentType: "parliamentary",
        })),
    });
    db.collectionMocks.governmentFormations.find.mockReturnValue({
      toArray: async () => [{ _id: "US", countryId: "US", pmCharacterId: characterId }],
    });
    db.collectionMocks.parliamentaryGovernments.find.mockReturnValue({ toArray: async () => [] });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("loads country and formation data in bulk while preserving the head-of-government role", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://game.test/api/discord-bot/sync-roles", {
        method: "POST",
      })
    );
    const payload = await response.json();

    expect(payload.users[0].details.isHeadOfGovernment).toBe(true);
    expect(db.collectionMocks.countryState.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.countryState.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.governmentFormations.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.governmentFormations.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.governmentFormations.find.mock.calls[0][0]).toEqual({
      _id: { $in: COUNTRY_ORDER },
    });
    expect(db.collectionMocks.parliamentaryGovernments.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.parliamentaryGovernments.findOne).not.toHaveBeenCalled();
  });
});
