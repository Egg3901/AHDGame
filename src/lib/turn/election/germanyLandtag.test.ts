import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

import { ensureDELandtagElections, resolveDELandtagElection } from "./germanyLandtag";
import { getDb } from "@/lib/mongodb";

interface MockState {
  _id: string;
  stateSenateSeats: number;
}

interface MockElection {
  _id: ObjectId;
  countryId: string;
  electionType: string;
  state: string;
  cycle: number;
  status: string;
  totalSeats: number;
  startTime?: Date;
  primaryEndTime?: Date;
  endTime?: Date;
  updatedAt?: Date;
}

function setupSpawnerMocks(db: MockDb, deLaender: MockState[], live: MockElection[] = []) {
  // states.find({ countryId: "DE" }, { projection: ... }).toArray()
  const statesCol = db.collection("states");
  statesCol.find = vi.fn().mockReturnValue({
    project: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(deLaender),
    }),
    toArray: vi.fn().mockResolvedValue(deLaender),
  });

  // gameState.findOne — currentTurn = 1 (default)
  const gsCol = db.collection("gameState");
  gsCol.findOne = vi.fn().mockResolvedValue({ _id: "current", currentTurn: 1 });

  // elections — needs to handle two `find` calls (live + completed) returning different shapes.
  // First call → live, second call → completed (sort().toArray())
  const electionsCol = db.collection("elections");
  let findCallCount = 0;
  electionsCol.find = vi.fn().mockImplementation(() => {
    findCallCount++;
    if (findCallCount === 1) {
      // live elections lookup
      return { toArray: vi.fn().mockResolvedValue(live) };
    }
    if (findCallCount === 2) {
      // completed elections lookup (.sort(...).toArray())
      return {
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      };
    }
    // duplicate-guard final lookup — return [] meaning no duplicates
    return {
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
      toArray: vi.fn().mockResolvedValue([]),
    };
  });
}

describe("ensureDELandtagElections — spawn", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);
  });

  it("schedules cycle-1 elections per Land using staggered anchors", async () => {
    setupSpawnerMocks(db, [
      { _id: "BW", stateSenateSeats: 154 },
      { _id: "BY", stateSenateSeats: 203 },
    ]);

    await ensureDELandtagElections(new Date());

    const insertCall = db.collectionMocks.elections!.insertMany.mock.calls[0];
    expect(insertCall).toBeDefined();
    const inserted = insertCall![0] as Array<{ state: string; totalSeats: number; cycle: number }>;
    expect(inserted.length).toBe(2);
    expect(inserted.find((e) => e.state === "BW")?.totalSeats).toBe(154);
    expect(inserted.find((e) => e.state === "BY")?.totalSeats).toBe(203);
    expect(inserted.every((e) => e.cycle === 1)).toBe(true);
  });

  it("skips Länder that already have a live Landtag election", async () => {
    setupSpawnerMocks(
      db,
      [
        { _id: "BW", stateSenateSeats: 154 },
        { _id: "BY", stateSenateSeats: 203 },
      ],
      [
        {
          _id: new ObjectId(),
          countryId: "DE",
          electionType: "landtag",
          state: "BW",
          cycle: 1,
          status: "active",
          totalSeats: 154,
        },
      ]
    );

    await ensureDELandtagElections(new Date());

    const insertCall = db.collectionMocks.elections!.insertMany.mock.calls[0];
    if (insertCall) {
      const inserted = insertCall[0] as Array<{ state: string }>;
      expect(inserted.find((e) => e.state === "BW")).toBeUndefined();
      expect(inserted.find((e) => e.state === "BY")).toBeDefined();
    }
  });

  it("skips Länder without a configured anchor", async () => {
    // ZZZ is not in LANDTAG_CYCLE1_END_TURN_BY_LAND
    setupSpawnerMocks(db, [{ _id: "ZZZ", stateSenateSeats: 100 }]);

    await ensureDELandtagElections(new Date());

    const insertCalls = db.collectionMocks.elections!.insertMany.mock.calls;
    expect(insertCalls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveDELandtagElection — Sainte-Laguë proportional
// ─────────────────────────────────────────────────────────────────────────────

function mkElection(state: string, totalSeats: number): MockElection & { _id: ObjectId } {
  return {
    _id: new ObjectId(),
    countryId: "DE",
    electionType: "landtag",
    state,
    cycle: 1,
    status: "active",
    totalSeats,
  };
}

describe("resolveDELandtagElection — proportional allocation", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  it("stores allocated party seats on Landtag winner rows", async () => {
    const election = mkElection("BW", 100);
    const cand1 = new ObjectId();
    const cand2 = new ObjectId();

    db.collection("electionVoteTallies").findOne = vi.fn().mockResolvedValue({
      _id: new ObjectId(),
      electionId: election._id,
      totalVotes: { [cand1.toString()]: 60000, [cand2.toString()]: 40000 },
    });
    db.collection("electionCandidates").find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: cand1, party: "spd", isNPP: true, characterName: "SPD NPP", nppId: new ObjectId() },
        { _id: cand2, party: "cdu", isNPP: true, characterName: "CDU NPP", nppId: new ObjectId() },
      ]),
    });

    const result = await resolveDELandtagElection(db as never, election as never, new Date());

    // Sainte-Laguë on 60/40 over 100 seats → SPD ~60, CDU ~40
    expect(result.winnersAllocated).toBe(2);
    expect(result.seatsAllocated).toBe(100);
    const insertedOfficials = db.collectionMocks.electedOfficials!.insertMany.mock
      .calls[0][0] as Array<{
      party: string;
      seatsHeld: number;
    }>;
    expect(insertedOfficials.find((o) => o.party === "spd")?.seatsHeld).toBe(60);
    expect(insertedOfficials.find((o) => o.party === "cdu")?.seatsHeld).toBe(40);
    expect(insertedOfficials.reduce((sum, o) => sum + o.seatsHeld, 0)).toBe(100);

    const tallyUpdate = db.collectionMocks.electionVoteTallies!.updateOne.mock.calls[0][1] as {
      $set: { seatsEstimate: Record<string, number> };
    };
    expect(tallyUpdate.$set.seatsEstimate[cand1.toString()]).toBe(60);
    expect(tallyUpdate.$set.seatsEstimate[cand2.toString()]).toBe(40);
  });

  it("filters parties below 5% Land threshold", async () => {
    const election = mkElection("BY", 100);
    const cSpd = new ObjectId();
    const cCdu = new ObjectId();
    const cFdp = new ObjectId();

    db.collection("electionVoteTallies").findOne = vi.fn().mockResolvedValue({
      _id: new ObjectId(),
      electionId: election._id,
      // SPD 50, CDU 47, FDP 3 — FDP below 5%
      totalVotes: {
        [cSpd.toString()]: 50,
        [cCdu.toString()]: 47,
        [cFdp.toString()]: 3,
      },
    });
    db.collection("electionCandidates").find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: cSpd, party: "spd", isNPP: true, characterName: "SPD", nppId: new ObjectId() },
        { _id: cCdu, party: "cdu", isNPP: true, characterName: "CDU", nppId: new ObjectId() },
        { _id: cFdp, party: "fdp", isNPP: true, characterName: "FDP", nppId: new ObjectId() },
      ]),
    });

    await resolveDELandtagElection(db as never, election as never, new Date());

    const insertedOfficials = db.collectionMocks.electedOfficials!.insertMany.mock
      .calls[0][0] as Array<{
      party: string;
      seatsHeld: number;
    }>;
    expect(insertedOfficials.find((o) => o.party === "fdp")).toBeUndefined();
    expect(insertedOfficials.find((o) => o.party === "spd")).toBeDefined();
    expect(insertedOfficials.find((o) => o.party === "cdu")).toBeDefined();
    expect(insertedOfficials.reduce((sum, o) => sum + o.seatsHeld, 0)).toBe(100);
  });

  it("ranks party candidates by vote share (player beats NPP)", async () => {
    const election = mkElection("HE", 1);
    const playerId = new ObjectId();
    const playerCharacterId = new ObjectId();
    const nppId = new ObjectId();
    const nppNppId = new ObjectId();

    db.collection("electionVoteTallies").findOne = vi.fn().mockResolvedValue({
      _id: new ObjectId(),
      electionId: election._id,
      totalVotes: {
        [playerId.toString()]: 1000,
        [nppId.toString()]: 500,
      },
    });
    db.collection("electionCandidates").find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: playerId,
          party: "spd",
          isNPP: false,
          characterId: playerCharacterId,
          characterName: "Player",
        },
        { _id: nppId, party: "spd", isNPP: true, characterName: "SPD NPP", nppId: nppNppId },
      ]),
    });
    // The player's character still exists (not deleted) — eligible to be seated.
    db.collection("characters").find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: playerCharacterId }]),
    });

    await resolveDELandtagElection(db as never, election as never, new Date());

    const insertedOfficials = db.collectionMocks.electedOfficials!.insertMany.mock
      .calls[0][0] as Array<{
      party: string;
      isNPP: boolean;
      characterId: ObjectId | null;
    }>;
    expect(insertedOfficials.length).toBe(1);
    expect(insertedOfficials[0].isNPP).toBe(false);
    expect(insertedOfficials[0].characterId?.toString()).toBe(playerCharacterId.toString());
  });

  it("splits one party's seats across same-party candidates by vote share", async () => {
    const election = mkElection("SL", 51);
    const cand1 = new ObjectId();
    const cand2 = new ObjectId();
    const cand3 = new ObjectId();

    db.collection("electionVoteTallies").findOne = vi.fn().mockResolvedValue({
      _id: new ObjectId(),
      electionId: election._id,
      totalVotes: {
        [cand1.toString()]: 300,
        [cand2.toString()]: 100,
        [cand3.toString()]: 400,
      },
    });
    db.collection("electionCandidates").find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: cand1, party: "spd", isNPP: true, characterName: "SPD A", nppId: new ObjectId() },
        { _id: cand2, party: "spd", isNPP: true, characterName: "SPD B", nppId: new ObjectId() },
        { _id: cand3, party: "cdu", isNPP: true, characterName: "CDU", nppId: new ObjectId() },
      ]),
    });

    const result = await resolveDELandtagElection(db as never, election as never, new Date());

    expect(result.seatsAllocated).toBe(51);
    const insertedOfficials = db.collectionMocks.electedOfficials!.insertMany.mock
      .calls[0][0] as Array<{
      characterName: string;
      party: string;
      seatsHeld: number;
    }>;
    const spdSeats = insertedOfficials
      .filter((o) => o.party === "spd")
      .reduce((sum, o) => sum + o.seatsHeld, 0);
    expect(spdSeats).toBe(26);
    expect(insertedOfficials.find((o) => o.characterName === "SPD A")?.seatsHeld).toBe(20);
    expect(insertedOfficials.find((o) => o.characterName === "SPD B")?.seatsHeld).toBe(6);
    expect(insertedOfficials.find((o) => o.party === "cdu")?.seatsHeld).toBe(25);
  });

  it("does not seat a candidate whose character was hard-deleted; the list seat falls to the next eligible candidate", async () => {
    const election = mkElection("NW", 1);
    const deletedPlayerCandId = new ObjectId();
    const deletedPlayerCharId = new ObjectId();
    const nppCandId = new ObjectId();
    const nppNppId = new ObjectId();

    db.collection("electionVoteTallies").findOne = vi.fn().mockResolvedValue({
      _id: new ObjectId(),
      electionId: election._id,
      // The deleted player out-polls the NPP, but must not be seated.
      totalVotes: {
        [deletedPlayerCandId.toString()]: 1000,
        [nppCandId.toString()]: 500,
      },
    });
    db.collection("electionCandidates").find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: deletedPlayerCandId,
          party: "spd",
          isNPP: false,
          characterId: deletedPlayerCharId,
          characterName: "Wolfgang Clement",
        },
        { _id: nppCandId, party: "spd", isNPP: true, characterName: "SPD NPP", nppId: nppNppId },
      ]),
    });
    // The deleted player's character document no longer exists.
    db.collection("characters").find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    await resolveDELandtagElection(db as never, election as never, new Date());

    const insertedOfficials = db.collectionMocks.electedOfficials!.insertMany.mock
      .calls[0][0] as Array<{ isNPP: boolean; characterId: ObjectId | null }>;
    // The live NPP takes the seat; no row references the deleted character.
    expect(insertedOfficials.length).toBe(1);
    expect(insertedOfficials[0].isNPP).toBe(true);
    expect(
      insertedOfficials.find((o) => o.characterId?.toString() === deletedPlayerCharId.toString())
    ).toBeUndefined();
  });

  it("returns 0 when no tally found", async () => {
    const election = mkElection("RP", 100);
    db.collection("electionVoteTallies").findOne = vi.fn().mockResolvedValue(null);

    const result = await resolveDELandtagElection(db as never, election as never, new Date());
    expect(result.winnersAllocated).toBe(0);
    expect(result.seatsAllocated).toBe(0);
    expect(db.collectionMocks.electedOfficials!.deleteMany).toHaveBeenCalledWith({
      officeType: "landtag",
      state: "RP",
    });
  });

  it("throws when called with wrong electionType/country", async () => {
    const wrong = { ...mkElection("BW", 100), countryId: "US" };
    await expect(resolveDELandtagElection(db as never, wrong as never, new Date())).rejects.toThrow(
      /wrong electionType\/country/
    );
  });
});
