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

    // The claim is the persisted token: a conditional $push of one entry
    // keyed by the formation-derived ids. Also assert the filter carries the
    // atomic guard (absence of the pair) plus the formation identity pins.
    const updateCall = db.collectionMocks.governmentFormations.updateOne.mock.calls[0];
    expect(updateCall[0]).toMatchObject({
      _id: "UK",
      reshuffleLog: { $not: { $elemMatch: expect.anything() } },
      cycle: 3,
      formedTurn: 50,
    });
    const identity = getReshuffleIdentity({
      countryId: "UK",
      pmCharacterId,
      formedTurn: 50,
      cycle: 3,
    });
    expect(updateCall[0].reshuffleLog.$not.$elemMatch).toMatchObject({
      governmentId: identity.governmentId,
      parliamentId: identity.parliamentId,
    });
    expect(updateCall[1].$push.reshuffleLog).toMatchObject({
      governmentId: identity.governmentId,
      parliamentId: identity.parliamentId,
    });
  });

  it("refuses a second reshuffle in the same parliament with a clear 409 reason", async () => {
    const { appointees, body } = ROSTER();
    seedGovernment(db, { pmCharacterId, cycle: 3, formedTurn: 50 }, appointees);

    const first = await reshuffleCabinetHandler(makeRequest(body), "UK" as never);
    expect(first.status).toBe(200);
    const claimedEntry =
      db.collectionMocks.governmentFormations.updateOne.mock.calls[0][1].$push.reshuffleLog;
    const persistedLog = [claimedEntry];

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
    const claimedEntry =
      db.collectionMocks.governmentFormations.updateOne.mock.calls[0][1].$push.reshuffleLog;
    const persistedLog = [claimedEntry];

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
    const claimedEntry =
      db.collectionMocks.governmentFormations.updateOne.mock.calls[0][1].$push.reshuffleLog;
    const persistedLog = [claimedEntry];

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

  it("refuses a roster naming a caretaker-held seat before claiming or vacating", async () => {
    const { appointees, body } = ROSTER();
    seedGovernment(db, { pmCharacterId, cycle: 3, formedTurn: 50 }, appointees);
    // The named chancellor seat is held by an NPP caretaker: it still owns
    // the (countryId, positionId) unique slot, so seating a player there
    // would fail on insert after the old roster was vacated.
    db.collectionMocks.cabinetMembers.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          countryId: "UK",
          positionId: "chancellor",
          characterId: null,
          isNPP: true,
          characterName: "Caretaker",
        },
      ],
    });

    const res = await reshuffleCabinetHandler(makeRequest(body), "UK" as never);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/held by a caretaker/);
    // Nothing claimed, nothing vacated, nothing seated.
    expect(db.collectionMocks.governmentFormations.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.cabinetMembers.deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.cabinetMembers.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
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

describe("reshuffleCabinetHandler atomic claim", () => {
  let db: MockDb;
  const pmCharacterId = new ObjectId();

  /** Formation store that emulates the conditional-$push atomicity of Mongo:
   * the claim filter only matches while the pair is absent, so concurrent
   * claims serialize exactly like the real collection. */
  function seedLiveFormation(extra: Partial<FormationSeed> = {}) {
    const seed = { pmCharacterId, cycle: 3, formedTurn: 50, ...extra };
    let log: { governmentId: string; parliamentId: string; at: Date }[] = [
      ...(seed.reshuffleLog ?? []),
    ];
    const doc = () => ({
      _id: "UK",
      countryId: "UK",
      pmCharacterId: seed.pmCharacterId,
      cycle: seed.cycle,
      formedTurn: seed.formedTurn,
      formedAt: new Date(0),
      reshuffleLog: [...log],
    });
    db.collectionMocks.governmentFormations.findOne.mockImplementation(async () => doc());
    db.collectionMocks.governmentFormations.updateOne.mockImplementation(
      async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        const push = (update.$push as Record<string, unknown> | undefined)?.reshuffleLog as
          { governmentId: string; parliamentId: string; at: Date } | undefined;
        if (push) {
          const wanted = (filter.reshuffleLog as Record<string, Record<string, unknown>>)?.$not
            ?.$elemMatch as { governmentId: string; parliamentId: string };
          const absent =
            wanted &&
            !log.some(
              (r) =>
                r.governmentId === wanted.governmentId && r.parliamentId === wanted.parliamentId
            );
          const pinsOk =
            (filter.pmCharacterId === undefined ||
              String(filter.pmCharacterId) === String(seed.pmCharacterId)) &&
            (filter.cycle === undefined || filter.cycle === seed.cycle) &&
            (filter.formedTurn === undefined || filter.formedTurn === seed.formedTurn);
          if (!absent || !pinsOk) return { matchedCount: 0, modifiedCount: 0 };
          log = [...log, push];
          return { matchedCount: 1, modifiedCount: 1 };
        }
        const pull = (update.$pull as Record<string, unknown> | undefined)?.reshuffleLog as
          { governmentId: string; parliamentId: string } | undefined;
        if (pull) {
          log = log.filter(
            (r) => !(r.governmentId === pull.governmentId && r.parliamentId === pull.parliamentId)
          );
          return { matchedCount: 1, modifiedCount: 1 };
        }
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );
    return { getLog: () => log };
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

  it("races two whole-cabinet requests: exactly one roster mutation and one token", async () => {
    const { appointees, body } = ROSTER();
    seedGovernment(db, { pmCharacterId, cycle: 3, formedTurn: 50 }, appointees);
    const store = seedLiveFormation();

    const [first, second] = await Promise.all([
      reshuffleCabinetHandler(makeRequest(body), "UK" as never),
      reshuffleCabinetHandler(makeRequest(body), "UK" as never),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    const loserJson = await loser.json();
    expect(loserJson.error).toMatch(/already used for this parliament/);

    // Exactly one token consumed and one roster written: the loser made no
    // cabinet mutations at all.
    expect(store.getLog()).toHaveLength(1);
    expect(db.collectionMocks.cabinetMembers.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.cabinetMembers.insertOne).toHaveBeenCalledTimes(2);
  });

  it("a claim lost after a stale read returns the repeat 409 and mutates nothing", async () => {
    const { appointees, body } = ROSTER();
    seedGovernment(db, { pmCharacterId, cycle: 3, formedTurn: 50 }, appointees);
    // Our read saw an empty log, but the atomic claim finds the pair taken
    // (a winner claimed between our read and our write); the re-read then
    // sees the winner's entry.
    let claimed = false;
    const identity = getReshuffleIdentity({
      countryId: "UK",
      pmCharacterId,
      formedTurn: 50,
      cycle: 3,
    });
    db.collectionMocks.governmentFormations.findOne.mockImplementation(async () => ({
      _id: "UK",
      countryId: "UK",
      pmCharacterId,
      cycle: 3,
      formedTurn: 50,
      formedAt: new Date(0),
      reshuffleLog: claimed ? [{ ...identity, at: new Date() }] : [],
    }));
    db.collectionMocks.governmentFormations.updateOne.mockImplementation(async () => {
      claimed = true;
      return { matchedCount: 0, modifiedCount: 0 };
    });

    const res = await reshuffleCabinetHandler(makeRequest(body), "UK" as never);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/already used for this parliament/);
    expect(db.collectionMocks.cabinetMembers.deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.cabinetMembers.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("a roster failure after claim releases the token so a retry reconciles", async () => {
    const { appointees, body } = ROSTER();
    seedGovernment(db, { pmCharacterId, cycle: 3, formedTurn: 50 }, appointees);
    const store = seedLiveFormation();
    db.collectionMocks.cabinetMembers.deleteMany.mockRejectedValueOnce(
      new Error("roster write failed")
    );

    const failed = await reshuffleCabinetHandler(makeRequest(body), "UK" as never);
    expect(failed.status).toBe(500);

    // Compensation released exactly our pair: the token is spendable again.
    const pullCall = db.collectionMocks.governmentFormations.updateOne.mock.calls.find(
      (call) => (call[1] as Record<string, unknown>).$pull !== undefined
    );
    expect(pullCall).toBeDefined();
    const identity = getReshuffleIdentity({
      countryId: "UK",
      pmCharacterId,
      formedTurn: 50,
      cycle: 3,
    });
    expect(
      (pullCall![1] as Record<string, Record<string, unknown>>).$pull.reshuffleLog
    ).toMatchObject({
      governmentId: identity.governmentId,
      parliamentId: identity.parliamentId,
    });
    expect(store.getLog()).toHaveLength(0);

    const retry = await reshuffleCabinetHandler(makeRequest(body), "UK" as never);
    expect(retry.status).toBe(200);
    expect(store.getLog()).toHaveLength(1);
  });
});
