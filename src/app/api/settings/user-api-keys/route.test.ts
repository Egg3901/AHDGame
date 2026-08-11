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
vi.mock("@/lib/api/userApiAuth", () => ({
  generateUserApiToken: vi.fn(() => ({
    token: "ahd_pub_plaintext",
    tokenHash: "userhash",
    prefix: "ahd_pub_plai",
  })),
}));

describe("/api/settings/user-api-keys", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("userApiKeys");
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
      new Request("http://localhost/api/settings/user-api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad json",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid JSON body" });
  });

  it("returns 400 when POST receives invalid scope", async () => {
    const userId = new ObjectId();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/settings/user-api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test", scope: "invalid" }),
      })
    );

    expect(response.status).toBe(400);
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
      new Request("http://localhost/api/settings/user-api-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId: keyId.toString() }),
      })
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.userApiKeys!.updateOne).toHaveBeenCalledWith(
      {
        _id: expect.any(ObjectId),
        userId: expect.any(ObjectId),
        revokedAt: null,
      },
      { $set: { revokedAt: expect.any(Date), updatedAt: expect.any(Date) } }
    );
  });

  it("rejects creating more than 3 keys per scope", async () => {
    const userId = new ObjectId();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    // Mock countDocuments to return 3 (at the limit)
    db.collectionMocks.userApiKeys!.countDocuments = vi.fn().mockResolvedValue(3);

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/settings/user-api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "overflow", scope: "public" }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("at most 3"),
    });
  });
});
