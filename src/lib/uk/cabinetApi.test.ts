import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
  CONGRESS_LIMITS: { maxRequests: 10, windowMs: 1000 },
}));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 100, effectiveNow: new Date(0) }),
}));

import { appointCabinetMemberHandler, fireCabinetMemberHandler } from "./cabinetApi";

const PM_USER_ID = new ObjectId().toString();

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/cn/executive/cabinet/appoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Wire up the PM/Premier identity in governmentFormations + characters so
 * requireCurrentPrimeMinister resolves. Returns the PM character id.
 */
function seedPrimeMinister(db: MockDb, countryId: string): ObjectId {
  const pmCharacterId = new ObjectId();
  db.collection("governmentFormations");
  db.collectionMocks.governmentFormations.findOne.mockResolvedValue({
    _id: countryId,
    pmCharacterId,
  });
  db.collection("characters");
  db.collectionMocks.characters.findOne.mockImplementation(
    async (query: Record<string, unknown>) => {
      if (query.userId) {
        return { _id: pmCharacterId, name: "Premier", userId: new ObjectId(PM_USER_ID) };
      }
      return null;
    }
  );
  return pmCharacterId;
}

describe("appointCabinetMemberHandler", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: PM_USER_ID },
    } as never);
    // Register so collectionMocks.cabinetMembers exists for assertions even
    // when the handler rejects before touching the collection.
    db.collection("cabinetMembers");
  });

  it("allows a One Party State to appoint a non-legislator player", async () => {
    const pmCharacterId = seedPrimeMinister(db, "CN");
    const civilianId = new ObjectId();

    // targetChar lookup by _id; PM lookup by userId.
    db.collectionMocks.characters.findOne.mockImplementation(
      async (query: Record<string, unknown>) => {
        if (query.userId)
          return { _id: pmCharacterId, name: "Premier", userId: new ObjectId(PM_USER_ID) };
        if (query._id) {
          return {
            _id: civilianId,
            name: "Loyal Civilian",
            userId: new ObjectId(),
            countryId: "CN",
            party: "ccp",
          };
        }
        return null;
      }
    );

    // No legislative seat for the civilian.
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue(null);
    // Not a banned party.
    db.collection("politicalParties");
    db.collectionMocks.politicalParties.findOne.mockResolvedValue({
      sequentialId: 1,
      countryId: "CN",
      regimeStatus: "ruling",
    });

    const res = await appointCabinetMemberHandler(
      makeRequest({ positionId: "vice_premier", characterId: civilianId.toString() }),
      "CN" as never
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(db.collectionMocks.cabinetMembers.insertOne).toHaveBeenCalled();
  });

  it("resets the position's setting cooldowns so the new minister can act immediately", async () => {
    const pmCharacterId = seedPrimeMinister(db, "CN");
    const civilianId = new ObjectId();
    db.collectionMocks.characters.findOne.mockImplementation(
      async (query: Record<string, unknown>) => {
        if (query.userId)
          return { _id: pmCharacterId, name: "Premier", userId: new ObjectId(PM_USER_ID) };
        if (query._id)
          return {
            _id: civilianId,
            name: "Loyal Civilian",
            userId: new ObjectId(),
            countryId: "CN",
            party: "ccp",
          };
        return null;
      }
    );
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue(null);
    db.collection("politicalParties");
    db.collectionMocks.politicalParties.findOne.mockResolvedValue({
      sequentialId: 1,
      countryId: "CN",
      regimeStatus: "ruling",
    });
    db.collection("cabinetSettings");

    const res = await appointCabinetMemberHandler(
      makeRequest({ positionId: "vice_premier", characterId: civilianId.toString() }),
      "CN" as never
    );

    expect(res.status).toBe(200);
    expect(db.collectionMocks.cabinetSettings.updateOne).toHaveBeenCalledWith(
      { _id: "CN_vice_premier" },
      { $unset: { lastChangedTurn: "", lastAllocationChangedTurn: "" } }
    );
  });

  it("sets a 24-turn appointment cooldown on the seat after appointing (lock persists through firing)", async () => {
    const pmCharacterId = seedPrimeMinister(db, "CN");
    const civilianId = new ObjectId();
    db.collectionMocks.characters.findOne.mockImplementation(
      async (query: Record<string, unknown>) => {
        if (query.userId)
          return { _id: pmCharacterId, name: "Premier", userId: new ObjectId(PM_USER_ID) };
        if (query._id)
          return {
            _id: civilianId,
            name: "Loyal Civilian",
            userId: new ObjectId(),
            countryId: "CN",
            party: "ccp",
          };
        return null;
      }
    );
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue(null);
    db.collection("politicalParties");
    db.collectionMocks.politicalParties.findOne.mockResolvedValue({
      sequentialId: 1,
      countryId: "CN",
      regimeStatus: "ruling",
    });
    db.collection("ukCabinetCooldowns");

    const res = await appointCabinetMemberHandler(
      makeRequest({ positionId: "vice_premier", characterId: civilianId.toString() }),
      "CN" as never
    );

    expect(res.status).toBe(200);
    // currentTurn 100 (mocked) + 24-turn cooldown = 124. Appointment SETS the
    // cooldown (it is no longer cleared on appoint, nor set on fire).
    expect(db.collectionMocks.ukCabinetCooldowns.updateOne).toHaveBeenCalledWith(
      { countryId: "CN", positionId: "vice_premier" },
      expect.objectContaining({ $set: expect.objectContaining({ cooldownUntilTurn: 124 }) }),
      { upsert: true }
    );
    expect(db.collectionMocks.ukCabinetCooldowns.deleteOne).not.toHaveBeenCalled();
  });

  it("blocks appointment while the seat is within its 24-turn appointment cooldown", async () => {
    const pmCharacterId = seedPrimeMinister(db, "CN");
    const civilianId = new ObjectId();
    db.collectionMocks.characters.findOne.mockImplementation(
      async (query: Record<string, unknown>) => {
        if (query.userId)
          return { _id: pmCharacterId, name: "Premier", userId: new ObjectId(PM_USER_ID) };
        if (query._id)
          return {
            _id: civilianId,
            name: "Loyal Civilian",
            userId: new ObjectId(),
            countryId: "CN",
            party: "ccp",
          };
        return null;
      }
    );
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue(null);
    db.collection("politicalParties");
    db.collectionMocks.politicalParties.findOne.mockResolvedValue({
      sequentialId: 1,
      countryId: "CN",
      regimeStatus: "ruling",
    });
    // Seat appointed 10 turns ago — cooldown still active (124 > currentTurn 100),
    // even though the seat is now empty (the minister was fired).
    db.collection("ukCabinetCooldowns");
    db.collectionMocks.ukCabinetCooldowns.findOne.mockResolvedValue({
      _id: new ObjectId(),
      countryId: "CN",
      positionId: "vice_premier",
      cooldownUntil: new Date(8640000000),
      cooldownUntilTurn: 124,
    });

    const res = await appointCabinetMemberHandler(
      makeRequest({ positionId: "vice_premier", characterId: civilianId.toString() }),
      "CN" as never
    );

    expect(res.status).toBe(409);
    expect(db.collectionMocks.cabinetMembers.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a banned-party member even in a One Party State", async () => {
    const pmCharacterId = seedPrimeMinister(db, "CN");
    const dissidentId = new ObjectId();
    db.collectionMocks.characters.findOne.mockImplementation(
      async (query: Record<string, unknown>) => {
        if (query.userId)
          return { _id: pmCharacterId, name: "Premier", userId: new ObjectId(PM_USER_ID) };
        if (query._id)
          return {
            _id: dissidentId,
            name: "Dissident",
            userId: new ObjectId(),
            countryId: "CN",
            party: "9",
          };
        return null;
      }
    );
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue(null);
    db.collection("politicalParties");
    db.collectionMocks.politicalParties.findOne.mockResolvedValue({
      sequentialId: 9,
      countryId: "CN",
      regimeStatus: "banned",
    });

    const res = await appointCabinetMemberHandler(
      makeRequest({ positionId: "vice_premier", characterId: dissidentId.toString() }),
      "CN" as never
    );

    expect(res.status).toBe(403);
    expect(db.collectionMocks.cabinetMembers.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a non-legislator in a non-OPS country (seat still required)", async () => {
    const pmCharacterId = seedPrimeMinister(db, "JP");
    const civilianId = new ObjectId();
    db.collectionMocks.characters.findOne.mockImplementation(
      async (query: Record<string, unknown>) => {
        if (query.userId)
          return { _id: pmCharacterId, name: "PM", userId: new ObjectId(PM_USER_ID) };
        if (query._id)
          return {
            _id: civilianId,
            name: "Civilian",
            userId: new ObjectId(),
            countryId: "JP",
            party: "ldp",
          };
        return null;
      }
    );
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue(null);

    const res = await appointCabinetMemberHandler(
      makeRequest({ positionId: "finance_minister", characterId: civilianId.toString() }),
      "JP" as never
    );

    expect(res.status).toBe(403);
    expect(db.collectionMocks.cabinetMembers.insertOne).not.toHaveBeenCalled();
  });

  it("rejects appointing to the head-of-government position (Premier)", async () => {
    const pmCharacterId = seedPrimeMinister(db, "CN");
    const targetId = new ObjectId();
    db.collectionMocks.characters.findOne.mockImplementation(
      async (query: Record<string, unknown>) => {
        if (query.userId)
          return { _id: pmCharacterId, name: "Premier", userId: new ObjectId(PM_USER_ID) };
        if (query._id)
          return {
            _id: targetId,
            name: "Pretender",
            userId: new ObjectId(),
            countryId: "CN",
            party: "1",
          };
        return null;
      }
    );

    const res = await appointCabinetMemberHandler(
      makeRequest({ positionId: "premier", characterId: targetId.toString() }),
      "CN" as never
    );

    expect(res.status).toBe(403);
    expect(db.collectionMocks.cabinetMembers.insertOne).not.toHaveBeenCalled();
  });

  it("rejects appointing to a seat not yet established in the current era", async () => {
    seedPrimeMinister(db, "UK");
    const targetId = new ObjectId();
    // Live year 1953 — the Northern Ireland Office (yearEnabled 1972) does not
    // exist yet.
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentYear: 1953,
    });

    const res = await appointCabinetMemberHandler(
      makeRequest({ positionId: "northern_ireland", characterId: targetId.toString() }),
      "UK" as never
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(String(json.error)).toContain("does not exist in the current era");
    expect(db.collectionMocks.cabinetMembers.insertOne).not.toHaveBeenCalled();
  });
});

describe("fireCabinetMemberHandler", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: PM_USER_ID },
    } as never);
    // Register so collectionMocks.cabinetMembers exists for assertions even
    // when the handler rejects before touching the collection.
    db.collection("cabinetMembers");
  });

  it("clears currentOffice when firing a non-legislator minister", async () => {
    seedPrimeMinister(db, "CN");
    const ministerId = new ObjectId();

    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: new ObjectId(),
      countryId: "CN",
      positionId: "vice_premier",
      characterId: ministerId,
      characterName: "Loyal Civilian",
    });
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue(null); // no seat

    const req = new Request("http://localhost/api/country/cn/executive/cabinet/fire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positionId: "vice_premier" }),
    });

    const res = await fireCabinetMemberHandler(req, "CN" as never);
    expect(res.status).toBe(200);

    // Find the characters.updateOne call that targeted the fired minister.
    const call = db.collectionMocks.characters.updateOne.mock.calls.find((c) =>
      (c[0] as { _id?: ObjectId })._id?.equals?.(ministerId)
    );
    expect(call).toBeDefined();
    const update = call![1] as { $unset?: Record<string, unknown> };
    expect(update.$unset).toHaveProperty("currentOffice");
  });

  it("does NOT set an appointment cooldown when firing (firing is unrestricted)", async () => {
    seedPrimeMinister(db, "CN");
    const ministerId = new ObjectId();

    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: new ObjectId(),
      countryId: "CN",
      positionId: "vice_premier",
      characterId: ministerId,
      characterName: "Loyal Civilian",
    });
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue(null);
    db.collection("ukCabinetCooldowns");

    const req = new Request("http://localhost/api/country/cn/executive/cabinet/fire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positionId: "vice_premier" }),
    });

    const res = await fireCabinetMemberHandler(req, "CN" as never);
    expect(res.status).toBe(200);
    // The appointment-era cooldown (set at appoint time) is left untouched, and
    // firing creates no new cooldown of its own.
    expect(db.collectionMocks.ukCabinetCooldowns.updateOne).not.toHaveBeenCalled();
  });

  it("rejects firing the head-of-government position (Premier)", async () => {
    seedPrimeMinister(db, "CN");

    const req = new Request("http://localhost/api/country/cn/executive/cabinet/fire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positionId: "premier" }),
    });

    const res = await fireCabinetMemberHandler(req, "CN" as never);
    expect(res.status).toBe(403);
    expect(db.collectionMocks.cabinetMembers.deleteOne).not.toHaveBeenCalled();
  });
});
