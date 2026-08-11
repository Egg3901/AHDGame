import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/userApiAuth", () => ({
  generateUserApiToken: vi.fn(() => ({
    token: "ahd_pub_rotated",
    tokenHash: "rotatedhash",
    prefix: "ahd_pub_rota",
  })),
}));

function makeRequest() {
  return new Request("http://localhost/api/settings/user-api-keys/x/rotate", { method: "POST" });
}

describe("POST /api/settings/user-api-keys/[id]/rotate", () => {
  let db: MockDb;
  const userId = new ObjectId();
  const keyId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("userApiKeys");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);
  });

  it("returns 400 for a malformed key id", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "not-an-id" }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the key is not found or not owned", async () => {
    db.collectionMocks.userApiKeys!.findOne = vi.fn().mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: keyId.toString() }) });
    expect(res.status).toBe(404);
  });

  it("issues a new token and schedules the old key for revocation", async () => {
    db.collectionMocks.userApiKeys!.findOne = vi.fn().mockResolvedValue({
      _id: keyId,
      userId,
      name: "my key",
      scope: "public",
    });
    db.collectionMocks.userApiKeys!.insertOne = vi
      .fn()
      .mockResolvedValue({ insertedId: new ObjectId() });
    db.collectionMocks.userApiKeys!.updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: keyId.toString() }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe("ahd_pub_rotated");
    expect(body.scope).toBe("public");
    expect(body.gracePeriodEndsAt).toBeDefined();

    // New key links back to the rotated one and starts unrevoked.
    expect(db.collectionMocks.userApiKeys!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "public",
        name: "my key",
        rotatedFrom: keyId,
        revokeAt: null,
      })
    );
    // Old key gets a future revokeAt, scoped to the owner.
    expect(db.collectionMocks.userApiKeys!.updateOne).toHaveBeenCalledWith(
      { _id: keyId, userId: expect.any(ObjectId) },
      { $set: expect.objectContaining({ revokeAt: expect.any(Date), rotatedAt: expect.any(Date) }) }
    );
  });
});
