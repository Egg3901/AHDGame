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
  it("does NOT reset the position's setting cooldowns, and seats a full action pool", async () => {
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

    // The reset used to happen here so an acting secretary could change settings
    // immediately. They can no longer change the department's stance at all, so
    // the reset buys them nothing. And because cabinetSettings is keyed by
    // POSITION rather than holder, handing one out per acting appointment would
    // let a president wipe a stance cooldown at will by seating a throwaway
    // acting holder and then confirming who they wanted all along. Confirmation
    // still resets it.
    expect(db.collectionMocks.cabinetSettings.updateOne).not.toHaveBeenCalled();

    // Seeded like every other appointment path. Without it the atomic `$gte: 1`
    // spend in the action-costing routes cannot match (Mongo does not match $gte
    // against a missing field), which is why each of those routes carries its own
    // backfill. This stops the acting path relying on that safety net.
    const inserted = db.collectionMocks.cabinetMembers.insertOne.mock.calls[0]?.[0] as {
      acting?: boolean;
      ministerialActions?: number;
      lastMinisterialActionResetDay?: string;
    };
    expect(inserted.acting).toBe(true);
    expect(inserted.ministerialActions).toBeGreaterThan(0);
    expect(inserted.lastMinisterialActionResetDay).toBeTruthy();
  });
});
