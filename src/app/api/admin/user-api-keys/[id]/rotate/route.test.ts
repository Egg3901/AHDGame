import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/api/userApiAuth", () => ({
  generateUserApiToken: vi.fn(() => ({
    token: "ahd_pub_adminrotated",
    tokenHash: "adminhash",
    prefix: "ahd_pub_admi",
  })),
}));

function makeRequest() {
  return new Request("http://localhost/api/admin/user-api-keys/x/rotate", { method: "POST" });
}

describe("POST /api/admin/user-api-keys/[id]/rotate", () => {
  let db: MockDb;
  const adminId = new ObjectId();
  const ownerId = new ObjectId();
  const keyId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("userApiKeys");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { userId: adminId.toString() },
    } as never);
  });

  it("returns 404 when the key is missing", async () => {
    db.collectionMocks.userApiKeys!.findOne = vi.fn().mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: keyId.toString() }) });
    expect(res.status).toBe(404);
  });

  it("rotates preserving the owner and returns the new token with a delivery warning", async () => {
    db.collectionMocks.userApiKeys!.findOne = vi.fn().mockResolvedValue({
      _id: keyId,
      userId: ownerId,
      name: "integration key",
      scope: "private",
    });
    db.collectionMocks.userApiKeys!.insertOne = vi
      .fn()
      .mockResolvedValue({ insertedId: new ObjectId() });
    db.collectionMocks.userApiKeys!.updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: keyId.toString() }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe("ahd_pub_adminrotated");
    expect(body.ownerUserId).toBe(ownerId.toString());
    expect(body.warning).toMatch(/secure channel/i);

    // New key keeps the original owner, not the admin.
    expect(db.collectionMocks.userApiKeys!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ownerId, scope: "private", rotatedFrom: keyId })
    );
    expect(db.collectionMocks.userApiKeys!.updateOne).toHaveBeenCalledWith(
      { _id: keyId },
      { $set: expect.objectContaining({ revokeAt: expect.any(Date) }) }
    );
  });
});
