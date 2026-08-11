import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    effectiveNow: new Date("2026-01-15T12:00:00.000Z"),
    currentTurn: 100,
    lastTurnProcessed: new Date("2026-01-15T11:00:00.000Z"),
    pausedAt: null,
    isActive: true,
  }),
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
  CONGRESS_LIMITS: { maxRequests: 30, windowMs: 60_000 },
}));

function duplicateKeyError(message: string, keyPattern: Record<string, number>) {
  return Object.assign(new Error(message), { code: 11000, keyPattern });
}

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();

  db.collection("electedOfficials");
  db.collection("characters");
  db.collection("cabinetNominations");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
});

describe("POST /api/whitehouse/cabinet/nominations", () => {
  it("treats a duplicate active-position insert as an existing nomination", async () => {
    const userId = new ObjectId();
    const presidentId = new ObjectId();
    const nomineeId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
      officeType: "president",
      characterId: presidentId,
    });
    db.collectionMocks["characters"]!.findOne.mockResolvedValueOnce({
      _id: presidentId,
      userId,
      name: "President Test",
      countryId: "US",
    }).mockResolvedValueOnce({
      _id: nomineeId,
      userId: new ObjectId(),
      name: "Cabinet Nominee",
      countryId: "US",
      party: "1",
    });
    db.collectionMocks["cabinetNominations"]!.updateMany.mockResolvedValue({
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
    } as never);
    db.collectionMocks["cabinetNominations"]!.insertOne.mockRejectedValue(
      duplicateKeyError(
        "E11000 duplicate key error collection: cabinetNominations index: unique_active_cabinet_nomination_per_position dup key",
        { countryId: 1, positionId: 1 }
      )
    );

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/whitehouse/cabinet/nominations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positionId: "secretary_of_state",
          nomineeCharacterId: nomineeId.toString(),
        }),
      })
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "An active nomination for this cabinet position already exists",
    });

    const { createNotification } = await import("@/lib/notifications");
    expect(createNotification).not.toHaveBeenCalled();
  });
});
