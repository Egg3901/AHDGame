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

import { reshuffleCabinetHandler } from "./cabinetApi";
import { getReshuffleIdentity } from "./cabinet/reshuffleLimit";

const PM_USER_ID = new ObjectId().toString();

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/uk/executive/cabinet/reshuffle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface FormationSeed {
  pmCharacterId: ObjectId;
  cycle: number;
  formedTurn: number;
  reshuffleLog?: { governmentId: string; parliamentId: string; at: Date }[];
}

/** Formation doc + character/elected-official mocks for a UK PM government. */
function seedGovernment(db: MockDb, seed: FormationSeed, appointees: ObjectId[]) {
  const { pmCharacterId, cycle, formedTurn } = seed;
  db.collection("governmentFormations");
  db.collectionMocks.governmentFormations.findOne.mockResolvedValue({
    _id: "UK",
    countryId: "UK",
    pmCharacterId,
    cycle,
    formedTurn,
    formedAt: new Date(0),
    reshuffleLog: seed.reshuffleLog ?? [],
  });

  const appointeeSet = new Set(appointees.map((id) => id.toString()));
  db.collection("characters");
  db.collectionMocks.characters.findOne.mockImplementation(
    async (query: Record<string, unknown>) => {
      if (query.userId) {
        return { _id: pmCharacterId, name: "PM", userId: new ObjectId(PM_USER_ID) };
      }
      const id = query._id as ObjectId | undefined;
      if (id && appointeeSet.has(id.toString())) {
        return {
          _id: id,
          name: `Minister ${id.toString().slice(-4)}`,
          userId: new ObjectId(),
          countryId: "UK",
          party: "1",
        };
      }
      return null;
    }
  );

  db.collection("electedOfficials");
  db.collectionMocks.electedOfficials.findOne.mockImplementation(
    async (query: Record<string, unknown>) => ({
      characterId: query.characterId,
      officeType: "commons",
      state: "Testshire",
      party: "1",
      countryId: "UK",
    })
  );

  for (const name of [
    "cabinetMembers",
    "ukCabinetCooldowns",
    "cabinetSettings",
    "gameConfig",
    "gameState",
  ]) {
    db.collection(name);
  }
  db.collectionMocks.cabinetMembers.find.mockReturnValue({ toArray: async () => [] });
  db.collectionMocks.gameConfig.findOne.mockResolvedValue(null);
  db.collectionMocks.gameState.findOne.mockResolvedValue(null);
}

const ROSTER = () => {
  const a = new ObjectId();
  const b = new ObjectId();
  return {
    appointees: [a, b] as ObjectId[],
    body: {
      appointments: [
        { positionId: "chancellor", characterId: a.toString() },
        { positionId: "chief_whip", characterId: b.toString() },
      ],
    },
  };
};

describe("reshuffleCabinetHandler", () => {
  let db: MockDb;
  const pmCharacterId = new ObjectId();

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

  it("succeeds once: vacates the old cabinet, seats the roster, persists the token", async () => {
    const { appointees, body } = ROSTER();
    seedGovernment(db, { pmCharacterId, cycle: 3, formedTurn: 50 }, appointees);

    const res = await reshuffleCabinetHandler(makeRequest(body), "UK" as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.appointed).toBe(2);
    expect(db.collectionMocks.cabinetMembers.deleteMany).toHaveBeenCalled();
    expect(db.collectionMocks.cabinetMembers.insertOne).toHaveBeenCalledTimes(2);

    // The persisted log is what the limiter reads: one entry keyed by the
    // formation-derived ids.
    const updateCall = db.collectionMocks.governmentFormations.updateOne.mock.calls[0];
    const nextLog = updateCall[1].$set.reshuffleLog;
    expect(nextLog).toHaveLength(1);
    const identity = getReshuffleIdentity({
      countryId: "UK",
      pmCharacterId,
      formedTurn: 50,
      cycle: 3,
    });
    expect(nextLog[0]).toMatchObject({
      governmentId: identity.governmentId,
      parliamentId: identity.parliamentId,
    });
  });

  it("refuses a second reshuffle in the same parliament with a clear 409 reason", async () => {
    const { appointees, body } = ROSTER();
    seedGovernment(db, { pmCharacterId, cycle: 3, formedTurn: 50 }, appointees);

    const first = await reshuffleCabinetHandler(makeRequest(body), "UK" as never);
    expect(first.status).toBe(200);
    const persistedLog = db.collectionMocks.governmentFormations.updateOne.mock.calls[0][1].$set
      .reshuffleLog;

    // End to end: feed the persisted log back as the stored state.
    seedGovernment(
      db,
      { pmCharacterId, cycle: 3, formedTurn: 50, reshuffleLog: persistedLog },
      appointees
    );
    db.collectionMocks.cabinetMembers.insertOne.mockClear();

    const second = await reshuffleCabinetHandler(makeRequest(body), "UK" as never);
    const json = await second.json();

    expect(second.status).toBe(409);
    expect(second.status).not.toBe(400);
    expect(json.error).toMatch(/already used for this parliament/);
    expect(db.collectionMocks.cabinetMembers.insertOne).not.toHaveBeenCalled();
  });

  it("a new parliament (cycle+1) resets the allowance", async () => {
    const { appointees, body } = ROSTER();
    seedGovernment(db, { pmCharacterId, cycle: 3, formedTurn: 50 }, appointees);
    const first = await reshuffleCabinetHandler(makeRequest(body), "UK" as never);
    expect(first.status).toBe(200);
    const persistedLog = db.collectionMocks.governmentFormations.updateOne.mock.calls[0][1].$set
      .reshuffleLog;

    seedGovernment(
      db,
      { pmCharacterId, cycle: 4, formedTurn: 50, reshuffleLog: persistedLog },
      appointees
    );

    const res = await reshuffleCabinetHandler(makeRequest(body), "UK" as never);
    expect(res.status).toBe(200);
  });

  it("a new government (new PM) in the same parliament resets the allowance", async () => {
    const { appointees, body } = ROSTER();
    seedGovernment(db, { pmCharacterId, cycle: 3, formedTurn: 50 }, appointees);
    const first = await reshuffleCabinetHandler(makeRequest(body), "UK" as never);
    expect(first.status).toBe(200);
    const persistedLog = db.collectionMocks.governmentFormations.updateOne.mock.calls[0][1].$set
      .reshuffleLog;

    const newPm = new ObjectId();
    seedGovernment(
      db,
      { pmCharacterId: newPm, cycle: 3, formedTurn: 80, reshuffleLog: persistedLog },
      appointees
    );

    const res = await reshuffleCabinetHandler(makeRequest(body), "UK" as never);
    expect(res.status).toBe(200);
  });

  it("a failed reshuffle does not consume the token", async () => {
    const { appointees, body } = ROSTER();
    seedGovernment(db, { pmCharacterId, cycle: 3, formedTurn: 50 }, appointees);

    const bad = await reshuffleCabinetHandler(
      makeRequest({
        appointments: [{ positionId: "not_a_seat", characterId: appointees[0]!.toString() }],
      }),
      "UK" as never
    );
    expect(bad.status).toBe(400);

    const formationUpdates = db.collectionMocks.governmentFormations.updateOne.mock.calls;
    expect(formationUpdates).toHaveLength(0);

    // The token is still available: a valid roster now succeeds.
    const res = await reshuffleCabinetHandler(makeRequest(body), "UK" as never);
    expect(res.status).toBe(200);
  });

  it("vacates outgoing ministers and restores their Commons office", async () => {
    const { appointees, body } = ROSTER();
    seedGovernment(db, { pmCharacterId, cycle: 3, formedTurn: 50 }, appointees);
    const outgoingId = new ObjectId();
    db.collectionMocks.cabinetMembers.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          countryId: "UK",
          positionId: "foreign_secretary",
          characterId: outgoingId,
          characterName: "Outgoing",
        },
      ],
    });

    const res = await reshuffleCabinetHandler(makeRequest(body), "UK" as never);
    expect(res.status).toBe(200);

    const restoreCall = db.collectionMocks.characters.updateOne.mock.calls.find(
      (call) => String((call[0] as Record<string, unknown>)._id) === outgoingId.toString()
    );
    expect(restoreCall).toBeDefined();
    expect(restoreCall![1]).toHaveProperty(["$set", "currentOffice"]);
  });
});
