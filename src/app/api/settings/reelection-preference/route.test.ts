import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));

describe("PATCH /api/settings/reelection-preference", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("users");
    db.collection("characters");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("updates the authenticated user's active character preference", async () => {
    const userId = new ObjectId();
    const inactiveCharacterId = new ObjectId();
    const activeCharacterId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: activeCharacterId,
      userId,
      autoRunForReelection: false,
    });

    const { PATCH } = await import("./route");
    const response = await PATCH(
      new Request("http://localhost/api/settings/reelection-preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoRunForReelection: true }),
      })
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.users.findOne).toHaveBeenCalledWith(
      { _id: userId },
      { projection: { activeCharacterId: 1 } }
    );
    expect(db.collectionMocks.characters.findOne).toHaveBeenCalledWith({
      _id: activeCharacterId,
      userId,
    });
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledWith(
      { _id: activeCharacterId },
      { $set: { autoRunForReelection: true } }
    );
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalledWith(
      { _id: inactiveCharacterId },
      expect.anything()
    );
  });
});
