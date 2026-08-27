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
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 400 }),
}));
vi.mock("@/lib/cabinet/liveGameYear", () => ({
  getLiveGameYear: vi.fn().mockResolvedValue(1953),
  getManuallyEnabledSeats: vi.fn().mockResolvedValue(new Set<string>()),
}));

let db: MockDb;
const userId = new ObjectId();
const presidentId = new ObjectId();
const appointeeId = new ObjectId();
const electedAt = new Date("2026-01-01T00:00:00.000Z");

function post(body: Record<string, unknown>, code = "us") {
  return import("./route").then(({ POST }) =>
    POST(
      new Request("http://localhost/api/country/us/executive/cabinet/acting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ code }) }
    )
  );
}

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();

  for (const name of [
    "electedOfficials",
    "characters",
    "cabinetMembers",
    "cabinetNominations",
    "cabinetSettings",
    "actingAppointmentCharges",
  ]) {
    db.collection(name);
  }

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: userId.toString() },
  } as never);

  db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
    officeType: "president",
    characterId: presidentId,
    electedAt,
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

  // Default happy path: seat vacant, charge unspent, nominee never rejected.
  db.collectionMocks["cabinetMembers"]!.findOne.mockResolvedValue(null);
  db.collectionMocks["actingAppointmentCharges"]!.findOne.mockResolvedValue(null);
  db.collectionMocks["cabinetNominations"]!.findOne.mockResolvedValue(null);
});

describe("POST /api/country/[code]/executive/cabinet/acting", () => {
  it("seats an acting holder with turn stamps and an action pool", async () => {
    const res = await post({
      positionId: "secretary_of_treasury",
      characterId: appointeeId.toString(),
    });
    expect(res.status).toBe(200);

    const inserted = db.collectionMocks["cabinetMembers"]!.insertOne.mock.calls[0][0];
    expect(inserted).toMatchObject({
      countryId: "US",
      positionId: "secretary_of_treasury",
      acting: true,
      actingSinceTurn: 400,
      actingExpiresOnTurn: 424,
    });
    expect(inserted.ministerialActions).toBeGreaterThan(0);
  });

  it("spends the seat's charge", async () => {
    await post({ positionId: "secretary_of_treasury", characterId: appointeeId.toString() });
    expect(db.collectionMocks["actingAppointmentCharges"]!.insertOne).toHaveBeenCalled();
  });

  it("refuses when the seat is already filled, so acting cannot bypass the Senate", async () => {
    db.collectionMocks["cabinetMembers"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: new ObjectId(),
      positionId: "secretary_of_treasury",
    });
    const res = await post({
      positionId: "secretary_of_treasury",
      characterId: appointeeId.toString(),
    });
    expect(res.status).toBe(409);
    expect(db.collectionMocks["cabinetMembers"]!.deleteOne).not.toHaveBeenCalled();
  });

  it("refuses when the seat's charge is already spent this presidency", async () => {
    db.collectionMocks["actingAppointmentCharges"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
    });
    const res = await post({
      positionId: "secretary_of_treasury",
      characterId: appointeeId.toString(),
    });
    expect(res.status).toBe(409);
  });

  it("refuses an appointee the Senate already rejected for this seat", async () => {
    db.collectionMocks["cabinetNominations"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      status: "rejected",
      nomineeCharacterId: appointeeId,
    });
    const res = await post({
      positionId: "secretary_of_treasury",
      characterId: appointeeId.toString(),
    });
    expect(res.status).toBe(409);
  });

  it("leaves a pending nomination running, because acting bridges to confirmation", async () => {
    await post({ positionId: "secretary_of_treasury", characterId: appointeeId.toString() });
    expect(db.collectionMocks["cabinetNominations"]!.updateMany).not.toHaveBeenCalled();
  });

  it("does not reset the seat's setting cooldowns", async () => {
    await post({ positionId: "secretary_of_treasury", characterId: appointeeId.toString() });
    expect(db.collectionMocks["cabinetSettings"]!.updateOne).not.toHaveBeenCalled();
  });

  it("refuses without seating anyone when the charge ledger reports a duplicate", async () => {
    // The ledger's unique index is the real lock against a double submit: the
    // pre-check can be raced, so a duplicate key must refuse rather than seat.
    db.collectionMocks["actingAppointmentCharges"]!.insertOne.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), { code: 11000 })
    );
    const res = await post({
      positionId: "secretary_of_treasury",
      characterId: appointeeId.toString(),
    });
    expect(res.status).toBe(409);
    expect(db.collectionMocks["cabinetMembers"]!.insertOne).not.toHaveBeenCalled();
  });

  it("refuses a seat that does not exist in the current era", async () => {
    // Homeland Security is a post-2002 department; in 1953 it is not a seat a
    // President can fill by any route. The nomination route already enforces
    // this, and acting must not be the way around it.
    const res = await post({
      positionId: "secretary_of_homeland",
      characterId: appointeeId.toString(),
    });
    expect(res.status).toBe(400);
    expect(db.collectionMocks["cabinetMembers"]!.insertOne).not.toHaveBeenCalled();
  });

  it("refuses a position id that belongs to another country's cabinet", async () => {
    const res = await post({
      positionId: "defence_secretary",
      characterId: appointeeId.toString(),
    });
    expect(res.status).toBe(400);
    expect(db.collectionMocks["cabinetMembers"]!.insertOne).not.toHaveBeenCalled();
  });

  it("gives the charge back when seating fails, so a lost race is not billed", async () => {
    db.collectionMocks["cabinetMembers"]!.insertOne.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), { code: 11000 })
    );
    const res = await post({
      positionId: "secretary_of_treasury",
      characterId: appointeeId.toString(),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(db.collectionMocks["actingAppointmentCharges"]!.deleteOne).toHaveBeenCalledWith({
      countryId: "US",
      positionId: "secretary_of_treasury",
      presidentCharacterId: presidentId,
      presidencyStartedAt: electedAt,
    });
  });

  it("404s for a country that does not confirm cabinet picks", async () => {
    const res = await post(
      { positionId: "secretary_of_treasury", characterId: appointeeId.toString() },
      "uk"
    );
    expect(res.status).toBe(404);
  });
});
