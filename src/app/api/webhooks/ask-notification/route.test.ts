import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAskToken", () => ({ requireAskToken: vi.fn(() => true) }));
vi.mock("@/lib/api/rateLimit", () => ({
  BOT_READ_LIMITS: { maxRequests: 60, windowMs: 60_000 },
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn(async () => undefined),
}));

function makeRequest(body: unknown) {
  return new Request("https://example.com/api/webhooks/ask-notification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/webhooks/ask-notification", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("resolves users by userId and discordId, creates notifications, reports unknowns positionally", async () => {
    const webUserId = new ObjectId();
    const discordUserId = new ObjectId();
    db.collectionMocks.users = db.collection("users");
    db.collectionMocks.users.findOne.mockImplementation(async (query: Record<string, unknown>) => {
      if (query._id && String(query._id) === String(webUserId)) return { _id: webUserId };
      if (query.discordId === "555") return { _id: discordUserId };
      return null;
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        events: [
          {
            userId: webUserId.toHexString(),
            kind: "ask_refund",
            title: "Ask credited a question back",
            body: "b1",
            url: "https://ask.lakesidegames.net/",
          },
          { discordId: "555", kind: "ask_watch", title: "Your Ask watch fired", body: "b2" },
          { discordId: "never-linked", kind: "ask_correction", title: "t3", body: "b3" },
        ],
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.results).toEqual([{ ok: true }, { ok: true }, { error: "unknown_user" }]);

    const { createNotifications } = await import("@/lib/notifications");
    const inputs = vi.mocked(createNotifications).mock.calls[0][0];
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      userId: webUserId,
      type: "ask_refund",
      title: "Ask credited a question back",
      metadata: { href: "https://ask.lakesidegames.net/", source: "ask" },
    });
    expect(inputs[1]).toMatchObject({ userId: discordUserId, type: "ask_watch" });
    // A missing or foreign url falls back to the Ask origin.
    expect(inputs[1].metadata).toMatchObject({ href: "https://ask.lakesidegames.net" });
  });

  it("rejects a foreign link target back to the Ask origin", async () => {
    const userId = new ObjectId();
    db.collectionMocks.users = db.collection("users");
    db.collectionMocks.users.findOne.mockResolvedValue({ _id: userId });

    const { POST } = await import("./route");
    await POST(
      makeRequest({
        events: [
          {
            userId: userId.toHexString(),
            kind: "ask_refund",
            title: "t",
            body: "b",
            url: "https://evil.example/phish",
          },
        ],
      })
    );
    const { createNotifications } = await import("@/lib/notifications");
    const inputs = vi.mocked(createNotifications).mock.calls[0][0];
    expect(inputs[0].metadata).toMatchObject({ href: "https://ask.lakesidegames.net" });
  });

  it("401s without the token and 400s malformed bodies", async () => {
    const { requireAskToken } = await import("@/lib/api/requireAskToken");
    vi.mocked(requireAskToken).mockReturnValueOnce(false);
    const { POST } = await import("./route");
    const denied = await POST(makeRequest({ events: [] }));
    expect(denied.status).toBe(401);

    const malformed = await POST(
      makeRequest({ events: [{ kind: "ask_refund", title: "t", body: "b" }] })
    );
    expect(malformed.status).toBe(400);
  });
});
