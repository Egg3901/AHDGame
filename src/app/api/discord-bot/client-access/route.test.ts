import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const requireBotToken = vi.fn(() => true);
const createAdminLog = vi.fn();

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireBotToken", () => ({ requireBotToken }));
vi.mock("@/lib/api/rateLimit", () => ({
  BOT_FINANCIAL_LIMITS: { maxRequests: 30, windowMs: 60_000 },
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/adminLog", () => ({ createAdminLog }));

function post(body: unknown): Request {
  return new Request("https://example.com/api/discord-bot/client-access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/discord-bot/client-access", () => {
  let db: MockDb;
  const userId = new ObjectId("507f1f77bcf86cd799439011");

  beforeEach(async () => {
    vi.clearAllMocks();
    requireBotToken.mockReturnValue(true);
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collectionMocks.users = db.collection("users");
    db.collectionMocks.characters = db.collection("characters");
  });

  it("rejects callers without the private bot token", async () => {
    requireBotToken.mockReturnValueOnce(false);
    const { POST } = await import("./route");
    const response = await POST(post({ discordId: "123" }));
    expect(response.status).toBe(401);
    expect(db.collectionMocks.users.findOne).not.toHaveBeenCalled();
  });

  it("returns 404 when the Discord id is not linked", async () => {
    db.collectionMocks.users.findOne.mockResolvedValueOnce(null);
    const { POST } = await import("./route");
    const response = await POST(post({ discordId: "123" }));
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.found).toBe(false);
  });

  it("does not overwrite a permanent entitlement", async () => {
    db.collectionMocks.users.findOne.mockResolvedValueOnce({
      _id: userId,
      username: "Ada",
      discordId: "123",
      discordUsername: "ada",
      singleplayerEntitledAt: new Date(),
    });
    db.collectionMocks.characters.findOne.mockResolvedValueOnce({ name: "Ada Lovelace" });
    const { POST } = await import("./route");
    const json = await (await POST(post({ discordId: "123", days: 14 }))).json();
    expect(json).toMatchObject({
      found: true,
      alreadyPermanent: true,
      extended: false,
      username: "Ada",
      characterName: "Ada Lovelace",
      expiresAt: null,
    });
    expect(db.collectionMocks.users.updateOne).not.toHaveBeenCalled();
    expect(createAdminLog).not.toHaveBeenCalled();
  });

  it("grants 30 days by default and records the grantor", async () => {
    const before = Date.now();
    db.collectionMocks.users.findOne.mockResolvedValueOnce({
      _id: userId,
      username: "Ada",
      discordId: "123",
      discordUsername: "ada",
    });
    db.collectionMocks.characters.findOne.mockResolvedValueOnce(null);
    const { POST } = await import("./route");
    const response = await POST(post({ discordId: "123", grantedBy: "egg#0001" }));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.found).toBe(true);
    expect(json.extended).toBe(true);
    expect(json.alreadyPermanent).toBe(false);
    expect(json.days).toBe(30);
    const expiresAt = Date.parse(json.expiresAt);
    expect(expiresAt).toBeGreaterThan(before + 29 * 24 * 60 * 60 * 1000);
    expect(expiresAt).toBeLessThan(before + 31 * 24 * 60 * 60 * 1000);
    expect(db.collectionMocks.users.updateOne).toHaveBeenCalledWith(
      { _id: userId },
      {
        $set: expect.objectContaining({
          clientAccessSource: "bot",
          clientAccessGrantedBy: "egg#0001",
          clientAccessExpiresAt: expect.any(Date),
        }),
      }
    );
    expect(createAdminLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "client_access_granted",
        username: "Ada",
        adminUsername: "egg#0001",
      })
    );
  });

  it("does not shorten an existing later expiry", async () => {
    const later = new Date(Date.now() + 80 * 24 * 60 * 60 * 1000);
    db.collectionMocks.users.findOne.mockResolvedValueOnce({
      _id: userId,
      username: "Ada",
      discordId: "123",
      clientAccessExpiresAt: later,
    });
    db.collectionMocks.characters.findOne.mockResolvedValueOnce(null);
    const { POST } = await import("./route");
    const json = await (await POST(post({ discordId: "123", days: 7 }))).json();
    expect(json.extended).toBe(false);
    expect(Date.parse(json.expiresAt)).toBe(later.getTime());
    expect(db.collectionMocks.users.updateOne).not.toHaveBeenCalled();
  });
});
