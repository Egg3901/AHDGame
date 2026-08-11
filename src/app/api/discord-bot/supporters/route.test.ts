import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
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

const request = new Request("https://example.com/api/discord-bot/supporters");

describe("GET /api/discord-bot/supporters", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns active supporters with tier and lists every linked discordId", async () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);

    db.collectionMocks.users = db.collection("users");
    db.collectionMocks.users.find.mockReturnValue(
      makeCursor([
        // active, no expiry -> supporter
        { discordId: "active-perm", patreonTier: "supporter", patreonExpiresAt: null },
        // active, future expiry -> supporter-plus
        { discordId: "active-plus", patreonTier: "supporter-plus", patreonExpiresAt: future },
        // expired -> linked but not a supporter
        { discordId: "expired", patreonTier: "supporter", patreonExpiresAt: past },
        // no tier -> linked but not a supporter
        { discordId: "none", patreonTier: null, patreonExpiresAt: null },
      ])
    );

    const { GET } = await import("./route");
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);

    expect(json.supporters).toEqual([
      { discordId: "active-perm", tier: "supporter" },
      { discordId: "active-plus", tier: "supporter-plus" },
    ]);

    // linkedDiscordIds includes ALL discord-linked users regardless of status.
    expect(json.linkedDiscordIds).toEqual(["active-perm", "active-plus", "expired", "none"]);
  });

  it("returns empty arrays when no users have Discord linked", async () => {
    db.collectionMocks.users = db.collection("users");
    db.collectionMocks.users.find.mockReturnValue(makeCursor([]));

    const { GET } = await import("./route");
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.supporters).toEqual([]);
    expect(json.linkedDiscordIds).toEqual([]);
  });
});
