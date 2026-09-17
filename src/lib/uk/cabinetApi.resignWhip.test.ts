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

import {
  appointCabinetMemberHandler,
  getWhipWithdrawnHandler,
  resignCabinetMemberHandler,
  restoreWhipHandler,
  withdrawWhipHandler,
} from "./cabinetApi";
import { resignNppCaretakerMinister } from "./cabinet/nppResignation";

const PM_USER_ID = new ObjectId().toString();
const MINISTER_USER_ID = new ObjectId().toString();

function post(path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** PM identity in governmentFormations + characters, for requireCurrentPrimeMinister. */
function seedPmGovernment(
  db: MockDb,
  opts: { countryId: string; governingPartyId?: string; pmUserId?: string }
): ObjectId {
  const pmCharacterId = new ObjectId();
  db.collection("governmentFormations");
  db.collectionMocks.governmentFormations.findOne.mockResolvedValue({
    _id: opts.countryId,
    countryId: opts.countryId,
    pmCharacterId,
    governingPartyId: opts.governingPartyId ?? "1",
    cycle: 3,
    formedTurn: 50,
    formedAt: new Date(0),
    reshuffleLog: [],
  });
  db.collection("characters");
  db.collectionMocks.characters.findOne.mockImplementation(
    async (query: Record<string, unknown>) => {
      if (query.userId) {
        return {
          _id: pmCharacterId,
          name: "PM",
          userId: new ObjectId(opts.pmUserId ?? PM_USER_ID),
          countryId: opts.countryId,
          party: opts.governingPartyId ?? "1",
        };
      }
      return null;
    }
  );
  return pmCharacterId;
}

function seedCabinetSeat(
  db: MockDb,
  opts: { countryId: string; positionId: string; holderId: ObjectId | null }
) {
  db.collection("cabinetMembers");
  db.collectionMocks.cabinetMembers.findOne.mockImplementation(
    async (query: Record<string, unknown>) => {
      if (query.positionId) {
        return opts.holderId
          ? {
              _id: new ObjectId(),
              countryId: opts.countryId,
              positionId: query.positionId,
              characterId: opts.holderId,
              characterName: "Holder",
            }
          : null;
      }
      return null;
    }
  );
  db.collectionMocks.cabinetMembers.deleteOne.mockResolvedValue({ deletedCount: 1 });
}

function seedUkGauge(db: MockDb) {
  db.collection("ukGovernment");
  db.collectionMocks.ukGovernment.findOne.mockResolvedValue(null);
}

describe("resignCabinetMemberHandler", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: MINISTER_USER_ID },
    } as never);
    db.collection("characters");
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue({
      characterId: new ObjectId(),
      officeType: "commons",
      state: "Testshire",
      party: "1",
      countryId: "UK",
    });
    db.collection("gameConfig");
    db.collection("gameState");
    db.collectionMocks.gameConfig.findOne.mockResolvedValue(null);
    db.collectionMocks.gameState.findOne.mockResolvedValue(null);
    seedUkGauge(db);
  });

  function seedCallerAsHolder(positionId: string, _junior = false) {
    const holderId = new ObjectId();
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: holderId,
      name: "Minister",
      userId: new ObjectId(MINISTER_USER_ID),
      countryId: "UK",
      party: "1",
    });
    seedCabinetSeat(db, {
      countryId: "UK",
      positionId,
      holderId,
    });
    return holderId;
  }

  it("lets the holder resign a junior seat: vacates, restores office, flat gauge hit", async () => {
    seedCallerAsHolder("chief_whip");
    const res = await resignCabinetMemberHandler(
      post("/api/country/uk/executive/cabinet/resign", { positionId: "chief_whip" }),
      "UK" as never
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(db.collectionMocks.cabinetMembers.deleteOne).toHaveBeenCalled();
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalled();
    // Flat ministerResigned hit (12) from a full gauge of 100.
    const gaugeWrite = db.collectionMocks.ukGovernment.updateOne.mock.calls[0][1].$set;
    expect(gaugeWrite.confidenceGauge).toBe(88);
  });

  it("doubles the hit for a Great Office resignation", async () => {
    seedCallerAsHolder("chancellor");
    const res = await resignCabinetMemberHandler(
      post("/api/country/uk/executive/cabinet/resign", { positionId: "chancellor" }),
      "UK" as never
    );
    expect(res.status).toBe(200);
    const gaugeWrite = db.collectionMocks.ukGovernment.updateOne.mock.calls[0][1].$set;
    expect(gaugeWrite.confidenceGauge).toBe(76);
  });

  it("refuses a non-holder with 404 and writes no gauge event", async () => {
    seedCallerAsHolder("chancellor");
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: new ObjectId(),
      name: "Backbencher",
      userId: new ObjectId(MINISTER_USER_ID),
      countryId: "UK",
      party: "1",
    });
    const res = await resignCabinetMemberHandler(
      post("/api/country/uk/executive/cabinet/resign", { positionId: "chancellor" }),
      "UK" as never
    );
    expect(res.status).toBe(404);
    expect(db.collectionMocks.ukGovernment.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.cabinetMembers.deleteOne).not.toHaveBeenCalled();
  });

  it("a lost fire/resignation race reports 404 and writes nothing", async () => {
    seedCallerAsHolder("chief_whip");
    // A concurrent fire won: our guarded delete matches nothing.
    db.collectionMocks.cabinetMembers.deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
    const res = await resignCabinetMemberHandler(
      post("/api/country/uk/executive/cabinet/resign", { positionId: "chief_whip" }),
      "UK" as never
    );
    expect(res.status).toBe(404);
    // Loser restores no office and records no confidence event.
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.ukGovernment.updateOne).not.toHaveBeenCalled();
  });

  it("rejects an invalid position with 400", async () => {
    seedCallerAsHolder("chancellor");
    const res = await resignCabinetMemberHandler(
      post("/api/country/uk/executive/cabinet/resign", { positionId: "not_a_seat" }),
      "UK" as never
    );
    expect(res.status).toBe(400);
  });

  it("writes no gauge event outside the UK", async () => {
    seedPmGovernment(db, { countryId: "CN" });
    const holderId = new ObjectId();
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: holderId,
      name: "Minister",
      userId: new ObjectId(MINISTER_USER_ID),
      countryId: "CN",
      party: "1",
    });
    seedCabinetSeat(db, { countryId: "CN", positionId: "vice_premier", holderId });
    const res = await resignCabinetMemberHandler(
      post("/api/country/cn/executive/cabinet/resign", { positionId: "vice_premier" }),
      "CN" as never
    );
    expect(res.status).toBe(200);
    expect(db.collectionMocks.ukGovernment.updateOne).not.toHaveBeenCalled();
  });
});

describe("whip withdraw/restore", () => {
  let db: MockDb;
  const targetId = new ObjectId();

  function seedTarget(party = "1", office: Record<string, unknown> | null = {}) {
    // One stable PM identity: requireCurrentPrimeMinister matches the
    // userId-lookup character against formation.pmCharacterId.
    const pmCharacterId = new ObjectId();
    db.collection("characters");
    db.collectionMocks.characters.findOne.mockImplementation(
      async (query: Record<string, unknown>) => {
        if (query.userId) {
          return {
            _id: pmCharacterId,
            name: "PM",
            userId: new ObjectId(PM_USER_ID),
            countryId: "UK",
            party: "1",
          };
        }
        if (query._id) {
          if ((query._id as ObjectId).toString() === pmCharacterId.toString()) {
            return {
              _id: pmCharacterId,
              name: "PM",
              userId: new ObjectId(PM_USER_ID),
              countryId: "UK",
              party: "1",
            };
          }
          return {
            _id: targetId,
            name: "Rebel MP",
            userId: new ObjectId(),
            countryId: "UK",
            party,
          };
        }
        return null;
      }
    );
    // PM lookup by _id for the governing-party fallback.
    db.collection("governmentFormations");
    db.collectionMocks.governmentFormations.findOne.mockImplementation(async () => ({
      _id: "UK",
      countryId: "UK",
      pmCharacterId,
      governingPartyId: "1",
      cycle: 3,
      formedTurn: 50,
      formedAt: new Date(0),
      reshuffleLog: [],
    }));
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials.findOne.mockImplementation(
      async (query: Record<string, unknown>) => {
        if (query._id) return { _id: query._id, whipWithdrawn: true, countryId: "UK" };
        if (office === null) return null;
        return {
          _id: new ObjectId(),
          characterId: targetId,
          officeType: "commons",
          state: "Testshire",
          party,
          countryId: "UK",
          ...(office as object),
        };
      }
    );
    db.collection("cabinetMembers");
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(null);
    db.collection("gameConfig");
    db.collection("gameState");
    db.collectionMocks.gameConfig.findOne.mockResolvedValue(null);
    db.collectionMocks.gameState.findOne.mockResolvedValue(null);
  }

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
  });

  it("withdraws the whip: sets suspension, reports elevated reselection risk", async () => {
    // requireCurrentPrimeMinister resolves the PM from the userId lookup.
    db.collection("governmentFormations");
    const pmCharacterId = new ObjectId();
    db.collectionMocks.governmentFormations.findOne.mockResolvedValue({
      _id: "UK",
      countryId: "UK",
      pmCharacterId,
      governingPartyId: "1",
      cycle: 3,
      formedTurn: 50,
      formedAt: new Date(0),
      reshuffleLog: [],
    });
    db.collection("characters");
    db.collectionMocks.characters.findOne.mockImplementation(
      async (query: Record<string, unknown>) => {
        if (query.userId) {
          return {
            _id: pmCharacterId,
            name: "PM",
            userId: new ObjectId(PM_USER_ID),
            countryId: "UK",
            party: "1",
          };
        }
        return {
          _id: targetId,
          name: "Rebel MP",
          userId: new ObjectId(),
          countryId: "UK",
          party: "1",
        };
      }
    );
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials.findOne.mockImplementation(
      async (query: Record<string, unknown>) => {
        if (query._id) return { _id: query._id, whipWithdrawn: true, countryId: "UK" };
        return {
          _id: new ObjectId(),
          characterId: targetId,
          officeType: "commons",
          state: "Testshire",
          party: "1",
          countryId: "UK",
        };
      }
    );
    db.collection("cabinetMembers");
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(null);
    db.collection("gameConfig");
    db.collection("gameState");
    db.collectionMocks.gameConfig.findOne.mockResolvedValue(null);
    db.collectionMocks.gameState.findOne.mockResolvedValue(null);
    db.collectionMocks.electedOfficials.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const res = await withdrawWhipHandler(
      post("/api/country/uk/executive/cabinet/whip/withdraw", {
        characterId: targetId.toString(),
      }),
      "UK" as never
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.reselectionRisk).toBe("elevated");
    expect(db.collectionMocks.electedOfficials.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ whipWithdrawn: { $ne: true } }),
      expect.objectContaining({
        $set: expect.objectContaining({ whipWithdrawn: true }),
      })
    );
  });

  it("refuses a repeat withdrawal with 409 and writes nothing", async () => {
    seedTarget("1");
    db.collectionMocks.electedOfficials.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });
    const res = await withdrawWhipHandler(
      post("/api/country/uk/executive/cabinet/whip/withdraw", {
        characterId: targetId.toString(),
      }),
      "UK" as never
    );
    expect(res.status).toBe(409);
  });

  it("refuses opposition MPs and seatless characters with 403", async () => {
    seedTarget("2");
    const opp = await withdrawWhipHandler(
      post("/api/country/uk/executive/cabinet/whip/withdraw", {
        characterId: targetId.toString(),
      }),
      "UK" as never
    );
    expect(opp.status).toBe(403);

    seedTarget("1", null);
    const seatless = await withdrawWhipHandler(
      post("/api/country/uk/executive/cabinet/whip/withdraw", {
        characterId: targetId.toString(),
      }),
      "UK" as never
    );
    expect(seatless.status).toBe(403);
  });

  it("restores the whip and reports standard reselection risk", async () => {
    seedTarget("1", { whipWithdrawn: true });
    db.collectionMocks.electedOfficials.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    const res = await restoreWhipHandler(
      post("/api/country/uk/executive/cabinet/whip/restore", {
        characterId: targetId.toString(),
      }),
      "UK" as never
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.reselectionRisk).toBe("standard");
  });

  it("refuses to restore a held whip with 409", async () => {
    seedTarget("1");
    db.collectionMocks.electedOfficials.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: targetId,
      officeType: "commons",
      countryId: "UK",
    });
    const res = await restoreWhipHandler(
      post("/api/country/uk/executive/cabinet/whip/restore", {
        characterId: targetId.toString(),
      }),
      "UK" as never
    );
    expect(res.status).toBe(409);
  });

  it("lists withdrawn MPs for the PM", async () => {
    seedTarget("1", { whipWithdrawn: true });
    db.collectionMocks.electedOfficials.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          characterId: targetId,
          characterName: "Rebel MP",
          constituency: "Testshire",
          party: "1",
          countryId: "UK",
          whipWithdrawn: true,
          whipWithdrawnAt: new Date(0),
        },
      ],
    });
    const res = await getWhipWithdrawnHandler(
      new Request("http://localhost/api/country/uk/executive/cabinet/whip"),
      "UK" as never
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.withdrawn).toHaveLength(1);
    expect(json.withdrawn[0].reselectionRisk).toBe("elevated");
  });

  it("bars a whip-withdrawn MP from cabinet appointment", async () => {
    const pmCharacterId = new ObjectId();
    db.collection("governmentFormations");
    db.collectionMocks.governmentFormations.findOne.mockResolvedValue({
      _id: "UK",
      countryId: "UK",
      pmCharacterId,
      governingPartyId: "1",
      cycle: 3,
      formedTurn: 50,
      formedAt: new Date(0),
      reshuffleLog: [],
    });
    db.collection("characters");
    db.collectionMocks.characters.findOne.mockImplementation(
      async (query: Record<string, unknown>) => {
        if (query.userId) {
          return {
            _id: pmCharacterId,
            name: "PM",
            userId: new ObjectId(PM_USER_ID),
            countryId: "UK",
            party: "1",
          };
        }
        return {
          _id: targetId,
          name: "Suspended MP",
          userId: new ObjectId(),
          countryId: "UK",
          party: "1",
        };
      }
    );
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: targetId,
      officeType: "commons",
      state: "Testshire",
      party: "1",
      countryId: "UK",
      whipWithdrawn: true,
    });
    db.collection("cabinetMembers");
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(null);
    db.collection("gameConfig");
    db.collection("gameState");
    db.collectionMocks.gameConfig.findOne.mockResolvedValue(null);
    db.collectionMocks.gameState.findOne.mockResolvedValue(null);

    const res = await appointCabinetMemberHandler(
      post("/api/country/uk/executive/cabinet/appoint", {
        positionId: "chief_whip",
        characterId: targetId.toString(),
      }),
      "UK" as never
    );
    expect(res.status).toBe(403);
    expect(db.collectionMocks.cabinetMembers.insertOne).not.toHaveBeenCalled();
  });
});

describe("resignNppCaretakerMinister", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("cabinetMembers");
    db.collection("ukGovernment");
    db.collectionMocks.ukGovernment.findOne.mockResolvedValue(null);
  });

  const memberId = new ObjectId();

  it("vacates the seat and takes the flat hit when the NPP quits", async () => {
    db.collectionMocks.cabinetMembers.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const result = await resignNppCaretakerMinister(db as unknown as Db, {
      countryId: "UK",
      memberId,
      positionId: "chief_whip",
      input: { approval: 0, turnsInPost: 10 },
      rng: () => 0,
      now: new Date(0),
    });
    expect(result.resigned).toBe(true);
    expect(db.collectionMocks.cabinetMembers.deleteOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: memberId, isNPP: true })
    );
    expect(db.collectionMocks.ukGovernment.updateOne.mock.calls[0][1].$set.confidenceGauge).toBe(
      88
    );
  });

  it("does nothing when the NPP stays", async () => {
    const result = await resignNppCaretakerMinister(db as unknown as Db, {
      countryId: "UK",
      memberId,
      positionId: "chief_whip",
      input: { approval: 100, turnsInPost: 10 },
      rng: () => 0.999,
      now: new Date(0),
    });
    expect(result.resigned).toBe(false);
    expect(db.collectionMocks.cabinetMembers.deleteOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.ukGovernment.updateOne).not.toHaveBeenCalled();
  });
});
