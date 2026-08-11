import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/botApiAuth", () => ({
  generateBotApiToken: vi.fn(() => ({
    token: "ahd_bot_plaintext",
    tokenHash: "hash",
    prefix: "ahd_bot_pref",
  })),
}));

describe("/api/settings/bot-api-keys", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("botApiKeys");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns 400 when POST receives invalid JSON", async () => {
    const userId = new ObjectId();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/settings/bot-api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad json",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid JSON body" });
  });

  it("returns 400 when DELETE receives a malformed key id", async () => {
    const userId = new ObjectId();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    const { DELETE } = await import("./route");
    const response = await DELETE(
      new Request("http://localhost/api/settings/bot-api-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId: "not-an-object-id" }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Invalid ID format"),
    });
  });

  it("only revokes active keys owned by the authenticated user", async () => {
    const userId = new ObjectId();
    const keyId = new ObjectId();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    const { DELETE } = await import("./route");
    const response = await DELETE(
      new Request("http://localhost/api/settings/bot-api-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId: keyId.toString() }),
      })
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.botApiKeys!.updateOne).toHaveBeenCalledWith(
      {
        _id: expect.any(ObjectId),
        userId: expect.any(ObjectId),
        revokedAt: null,
      },
      { $set: { revokedAt: expect.any(Date), updatedAt: expect.any(Date) } }
    );
  });
});
