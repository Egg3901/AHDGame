import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
  CONGRESS_LIMITS: { maxRequests: 30, windowMs: 60_000 },
}));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();

  db.collection("electedOfficials");
  db.collection("characters");
  db.collection("cabinetMembers");
  db.collection("cabinetNominations");
  db.collection("cabinetSettings");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
});

describe("POST /api/whitehouse/cabinet/acting", () => {
  it("resets the position's setting cooldowns so the acting secretary can act immediately", async () => {
    const userId = new ObjectId();
    const presidentId = new ObjectId();
    const appointeeId = new ObjectId();

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
    }).mockResolvedValueOnce({
      _id: appointeeId,
      userId: new ObjectId(),
      name: "Acting Secretary",
      countryId: "US",
      party: "1",
    });

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/whitehouse/cabinet/acting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positionId: "secretary_of_treasury",
          characterId: appointeeId.toString(),
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(db.collectionMocks.cabinetSettings.updateOne).toHaveBeenCalledWith(
      { _id: "US_secretary_of_treasury" },
      {
        $unset: {
          lastChangedTurn: "",
          lastAllocationChangedTurn: "",
          lastRegionChangedTurn: "",
          lastTargetCountryChangedTurn: "",
          lastAidPriorityChangedTurn: "",
        },
      }
    );
  });
});
