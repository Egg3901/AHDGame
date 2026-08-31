import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const gameClock = vi.hoisted(() => ({
  currentTurn: 100,
  effectiveNow: new Date("2026-01-01T00:00:00Z"),
}));

vi.mock("@/lib/time/gameTime", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/time/gameTime")>()),
  getGameTime: vi.fn(async () => ({
    currentTurn: gameClock.currentTurn,
    effectiveNow: gameClock.effectiveNow,
    lastTurnProcessed: gameClock.effectiveNow,
    isActive: true,
    pausedAt: null,
    startingYear: 1962,
  })),
}));

describe("queryElectionList", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    gameClock.currentTurn = 100;
    gameClock.effectiveNow = new Date("2026-01-01T00:00:00Z");
    db = createMockDb();
    ["elections", "electionCandidates", "electionVoteTallies", "politicalParties"].forEach((n) =>
      db.collection(n)
    );
  });

  it("returns empty list when no elections found", async () => {
    db.collectionMocks.elections!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryElectionList } = await import("./election");
    const result = await queryElectionList(db as unknown as Db, { country: "US" });
    expect(result).toEqual({ found: false, elections: [] });
  });

  // "ended" is NOT a member of ElectionStatus and is never written by the game —
  // reading phase off status strings like this is what hid the original bug. Kept
  // as a guard that an unrecognised status still resolves from the time bounds.
  it("still totals the votes when the status is not one it recognises", async () => {
    const elecId = new ObjectId();
    db.collectionMocks.elections!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: elecId,
          seatId: "US-senate-CA-1",
          electionType: "senate",
          state: "CA",
          status: "ended",
          startTime: new Date("2025-01-01"),
          endTime: new Date("2025-01-08"),
          countryId: "US",
        },
      ]),
    } as never);

    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          characterId: new ObjectId(),
          electionId: elecId,
          characterName: "Jane Smith",
          party: "1",
          isNPP: false,
        },
      ]),
    } as never);

    db.collectionMocks.electionVoteTallies!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          electionId: elecId,
          totalVotes: { char1: 500, char2: 300 },
        },
      ]),
    } as never);

    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryElectionList } = await import("./election");
    const result = await queryElectionList(db as unknown as Db, { country: "US", state: "CA" });

    expect(result.found).toBe(true);
    expect(result.elections[0]).toHaveProperty("finalVotes");
  });

  describe("results opt-in (ticket #1229)", () => {
    const elecId = new ObjectId();

    function seedTalliedRace() {
      db.collectionMocks.elections!.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          {
            _id: elecId,
            seatId: "US-senate-CA-1",
            electionType: "senate",
            state: "CA",
            status: "general",
            startTime: new Date("2025-01-01"),
            countryId: "US",
          },
        ]),
      } as never);
      db.collectionMocks.electionCandidates!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      } as never);
      db.collectionMocks.electionVoteTallies!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            electionId: elecId,
            totalVotes: { char1: 300, char2: 700 },
            candidateNames: { char1: "Jane Smith", char2: "John Doe" },
            candidateParties: { char1: "Democratic", char2: "Republican" },
            finalized: false,
          },
        ]),
      } as never);
      db.collectionMocks.politicalParties!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      } as never);
    }

    it("surfaces per-candidate standings, leader first, when results=true", async () => {
      seedTalliedRace();
      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, {
        country: "US",
        state: "CA",
        results: true,
      });

      const race = result.elections[0] as {
        results: {
          totalVotes: number;
          finalized: boolean;
          candidates: Array<{
            characterName: string;
            party: string;
            votes: number;
            sharePct: number;
          }>;
        };
      };
      expect(race.results.totalVotes).toBe(1000);
      expect(race.results.finalized).toBe(false);
      // Leader first, share as a percentage of the total on the row.
      expect(race.results.candidates[0]).toMatchObject({
        characterName: "John Doe",
        party: "Republican",
        votes: 700,
        sharePct: 70,
      });
      expect(race.results.candidates[1]).toMatchObject({ characterName: "Jane Smith", votes: 300 });
    });

    it("omits the results key entirely by default, so existing callers are unchanged", async () => {
      seedTalliedRace();
      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US", state: "CA" });

      expect(result.elections[0]).not.toHaveProperty("results");
    });
  });

  describe("ballot", () => {
    // Entering a race withdraws any prior row and inserts a fresh one, and the
    // primary resolver withdraws the losers, so withdrawn rows pile up per
    // character. They are kept as history, but split out of the standing ballot
    // so the default read does not imply they are still running.
    function seedRace(electionOverrides: Record<string, unknown>, candidates: unknown[]) {
      const elecId = new ObjectId();
      db.collectionMocks.elections!.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          {
            _id: elecId,
            seatId: "US-house-NY-1",
            electionType: "house",
            state: "NY",
            status: "active",
            countryId: "US",
            startTurn: 90,
            primaryEndTurn: 190,
            endTurn: 240,
            ...electionOverrides,
          },
        ]),
      } as never);
      db.collectionMocks.electionCandidates!.find.mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue(candidates.map((c) => ({ ...(c as object), electionId: elecId }))),
      } as never);
      db.collectionMocks.electionVoteTallies!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      } as never);
      db.collectionMocks.politicalParties!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      } as never);
      return elecId;
    }

    it("omits candidates who have withdrawn from a live race", async () => {
      seedRace({}, [
        {
          characterId: new ObjectId(),
          characterName: "Sean Oppenheimer",
          party: "1",
          status: "active",
        },
        {
          characterId: new ObjectId(),
          characterName: "Kimberly Lincoln",
          party: "4",
          status: "withdrawn",
        },
      ]);

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      expect(result.elections[0].candidates.map((c) => c.characterName)).toEqual([
        "Sean Oppenheimer",
      ]);
    });

    it("keeps a withdrawn candidacy as history rather than discarding it", async () => {
      seedRace({}, [
        {
          characterId: new ObjectId(),
          characterName: "Sean Oppenheimer",
          party: "1",
          status: "active",
        },
        {
          characterId: new ObjectId(),
          characterName: "Kimberly Lincoln",
          party: "4",
          status: "withdrawn",
          withdrawnAt: new Date("2026-02-03T00:00:00Z"),
        },
      ]);

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      expect(result.elections[0].formerCandidates).toEqual([
        expect.objectContaining({
          characterName: "Kimberly Lincoln",
          status: "withdrawn",
          withdrawnAt: "2026-02-03T00:00:00.000Z",
        }),
      ]);
    });

    it("lists a candidate who left and re-entered once, with each departure kept", async () => {
      const malik = new ObjectId();
      seedRace({}, [
        {
          characterId: malik,
          characterName: "Malik Rahman",
          party: "1",
          status: "withdrawn",
          withdrawnAt: new Date("2026-01-10T00:00:00Z"),
        },
        {
          characterId: malik,
          characterName: "Malik Rahman",
          party: "1",
          status: "withdrawn",
          withdrawnAt: new Date("2026-01-20T00:00:00Z"),
        },
        { characterId: malik, characterName: "Malik Rahman", party: "1", status: "active" },
      ]);

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      expect(result.elections[0].candidates).toHaveLength(1);
      expect(result.elections[0].formerCandidates).toHaveLength(2);
    });

    it("orders former candidacies most recent departure first", async () => {
      const malik = new ObjectId();
      seedRace({}, [
        {
          characterId: malik,
          characterName: "Older",
          party: "1",
          status: "withdrawn",
          withdrawnAt: new Date("2026-01-10T00:00:00Z"),
        },
        {
          characterId: malik,
          characterName: "Newer",
          party: "1",
          status: "withdrawn",
          withdrawnAt: new Date("2026-01-20T00:00:00Z"),
        },
      ]);

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      expect(result.elections[0].formerCandidates.map((c) => c.characterName)).toEqual([
        "Newer",
        "Older",
      ]);
    });

    it("splits a completed race the same way, keeping its primary losers", async () => {
      seedRace({ status: "completed" }, [
        { characterId: new ObjectId(), characterName: "Winner", party: "1", status: "active" },
        {
          characterId: new ObjectId(),
          characterName: "GeneralLoser",
          party: "4",
          status: "active",
        },
        {
          characterId: new ObjectId(),
          characterName: "PrimaryLoser",
          party: "1",
          status: "withdrawn",
        },
      ]);

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      expect(result.elections[0].candidates.map((c) => c.characterName)).toEqual([
        "Winner",
        "GeneralLoser",
      ]);
      expect(result.elections[0].formerCandidates.map((c) => c.characterName)).toEqual([
        "PrimaryLoser",
      ]);
    });

    it("treats a candidate whose row predates the status field as standing", async () => {
      seedRace({}, [{ characterId: new ObjectId(), characterName: "Legacy Row", party: "1" }]);

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      expect(result.elections[0].candidates).toHaveLength(1);
      expect(result.elections[0].candidates[0].status).toBe("active");
      expect(result.elections[0].formerCandidates).toEqual([]);
    });

    it("reports a withdrawal with no recorded timestamp as null", async () => {
      seedRace({}, [
        {
          characterId: new ObjectId(),
          characterName: "No Timestamp",
          party: "1",
          status: "withdrawn",
        },
      ]);

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      expect(result.elections[0].formerCandidates[0].withdrawnAt).toBeNull();
    });
  });

  describe("phase", () => {
    // Every live race carries status "active" for both its primary and its
    // general, so phase has to come from the turn/time bounds instead.
    function seedActiveRace(overrides: Record<string, unknown> = {}) {
      const elecId = new ObjectId();
      db.collectionMocks.elections!.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          {
            _id: elecId,
            seatId: "US-senate-CA-1",
            electionType: "senate",
            state: "CA",
            status: "active",
            countryId: "US",
            startTurn: 90,
            primaryEndTurn: 190,
            endTurn: 240,
            startTime: new Date("2025-12-01T00:00:00Z"),
            primaryEndTime: new Date("2026-02-01T00:00:00Z"),
            endTime: new Date("2026-04-01T00:00:00Z"),
            ...overrides,
          },
        ]),
      } as never);
      db.collectionMocks.electionCandidates!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      } as never);
      db.collectionMocks.electionVoteTallies!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      } as never);
      db.collectionMocks.politicalParties!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      } as never);
      return elecId;
    }

    it("reports primary while the primary window is still open", async () => {
      gameClock.currentTurn = 100;
      seedActiveRace();

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      expect(result.elections[0].phase).toBe("primary");
    });

    it("reports general once the primary has closed", async () => {
      gameClock.currentTurn = 200;
      seedActiveRace();

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      expect(result.elections[0].phase).toBe("general");
    });

    it("reports upcoming before the race has started", async () => {
      gameClock.currentTurn = 50;
      seedActiveRace();

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      expect(result.elections[0].phase).toBe("upcoming");
    });

    it("reports ended once the general has closed", async () => {
      gameClock.currentTurn = 250;
      seedActiveRace({ status: "completed" });

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      expect(result.elections[0].phase).toBe("ended");
    });

    it("does not call votes final until the race has actually been resolved", async () => {
      // endTurn has passed but the resolver has not run yet, so status is still
      // "active" and the totals can still move.
      gameClock.currentTurn = 250;
      const elecId = seedActiveRace();
      db.collectionMocks.electionVoteTallies!.find.mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([{ electionId: elecId, totalVotes: { char1: 500, char2: 300 } }]),
      } as never);

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      expect(result.elections[0].finalVotes).toEqual({ totalVotes: 800, finalized: false });
    });

    it("calls votes final once the race is resolved", async () => {
      gameClock.currentTurn = 250;
      const elecId = seedActiveRace({ status: "resolved" });
      db.collectionMocks.electionVoteTallies!.find.mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([{ electionId: elecId, totalVotes: { char1: 500, char2: 300 } }]),
      } as never);

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      expect(result.elections[0].finalVotes).toEqual({ totalVotes: 800, finalized: true });
    });

    it("reports cancelled ahead of the turn bounds", async () => {
      gameClock.currentTurn = 100;
      seedActiveRace({ status: "cancelled" });

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      expect(result.elections[0].phase).toBe("cancelled");
    });

    it("withholds finalVotes from a cancelled race that ran past its end turn", async () => {
      gameClock.currentTurn = 250;
      const elecId = seedActiveRace({ status: "cancelled" });
      db.collectionMocks.electionVoteTallies!.find.mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([{ electionId: elecId, totalVotes: { char1: 500, char2: 300 } }]),
      } as never);

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      expect(result.elections[0]).not.toHaveProperty("finalVotes");
    });

    it("falls back to primaryEndTime when turn bounds are absent", async () => {
      gameClock.currentTurn = 100;
      gameClock.effectiveNow = new Date("2026-03-01T00:00:00Z");
      seedActiveRace({ startTurn: undefined, primaryEndTurn: undefined, endTurn: undefined });

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      // primaryEndTime 2026-02-01 has passed, endTime 2026-04-01 has not.
      expect(result.elections[0].phase).toBe("general");
    });

    it("exposes the deadline of the phase the race is actually in", async () => {
      gameClock.currentTurn = 100;
      seedActiveRace();

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      const race = result.elections[0];
      expect(race.primaryEndTime).toBe("2026-02-01T00:00:00.000Z");
      expect(race.phaseEndTurn).toBe(190);
      expect(race.phaseEndTime).toBe("2026-02-01T00:00:00.000Z");
    });

    it("advances the phase deadline to the general once the primary closes", async () => {
      gameClock.currentTurn = 200;
      seedActiveRace();

      const { queryElectionList } = await import("./election");
      const result = await queryElectionList(db as unknown as Db, { country: "US" });

      const race = result.elections[0];
      expect(race.phaseEndTurn).toBe(240);
      expect(race.phaseEndTime).toBe("2026-04-01T00:00:00.000Z");
    });
  });
});

describe("queryElectionDetail", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    gameClock.currentTurn = 100;
    gameClock.effectiveNow = new Date("2026-01-01T00:00:00Z");
    db = createMockDb();
    [
      "elections",
      "electionCandidates",
      "electionVoteTallies",
      "primarySnapshots",
      "politicalParties",
    ].forEach((n) => db.collection(n));
  });

  it("returns null when election not found", async () => {
    db.collectionMocks.elections!.findOne.mockResolvedValue(null);
    const { queryElectionDetail } = await import("./election");
    const result = await queryElectionDetail(db as unknown as Db, new ObjectId().toString());
    expect(result).toBeNull();
  });

  it("returns null incumbent when no winner on record", async () => {
    const elecId = new ObjectId();
    db.collectionMocks
      .elections!.findOne.mockResolvedValueOnce({
        _id: elecId,
        seatId: "US-senate-CA-1",
        electionType: "senate",
        state: "CA",
        stateName: "California",
        countryId: "US",
        cycle: 2,
        status: "active",
        totalSeats: 1,
        startTime: new Date("2025-01-01"),
        endTime: new Date("2025-01-08"),
      })
      .mockResolvedValueOnce(null); // prior cycle lookup

    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.electionVoteTallies!.findOne.mockResolvedValue(null);
    db.collectionMocks.primarySnapshots!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryElectionDetail } = await import("./election");
    const result = await queryElectionDetail(db as unknown as Db, elecId.toString());

    expect(result).not.toBeNull();
    expect(result!.incumbent).toBeNull();
  });

  it("projects primarySnapshots to clean shape (no internal fields)", async () => {
    const elecId = new ObjectId();
    db.collectionMocks.elections!.findOne.mockResolvedValueOnce({
      _id: elecId,
      seatId: "US-house-CA-1",
      electionType: "house",
      state: "CA",
      stateName: "California",
      countryId: "US",
      cycle: 1,
      status: "completed",
      totalSeats: 1,
      startTime: new Date("2025-01-01"),
      endTime: new Date("2025-01-08"),
    });
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.electionVoteTallies!.findOne.mockResolvedValue(null);
    db.collectionMocks.primarySnapshots!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          electionId: elecId,
          recordedAt: new Date("2025-01-05"),
          byParty: {
            "1": [
              {
                candidateId: "char1",
                characterName: "Jane",
                party: "1",
                primaryScore: 80,
                sharePct: 60,
                _internalField: "should_not_appear",
              },
            ],
          },
          _rawDbField: "should_not_appear",
        },
      ]),
    } as never);
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryElectionDetail } = await import("./election");
    const result = await queryElectionDetail(db as unknown as Db, elecId.toString());

    expect(result).not.toBeNull();
    const snap = result!.primarySnapshots[0];
    expect(snap).toHaveProperty("turn", 1);
    expect(snap.candidates[0]).toHaveProperty("name", "Jane");
    expect(snap.candidates[0]).toHaveProperty("sharePct", 60);
    expect(snap.candidates[0]).not.toHaveProperty("_internalField");
    expect(snap).not.toHaveProperty("_rawDbField");
  });

  it("omits candidates who have withdrawn from a live race", async () => {
    const elecId = new ObjectId();
    db.collectionMocks
      .elections!.findOne.mockResolvedValueOnce({
        _id: elecId,
        seatId: "US-house-NY-1",
        electionType: "house",
        state: "NY",
        countryId: "US",
        cycle: 1,
        status: "active",
        totalSeats: 1,
        startTurn: 90,
        primaryEndTurn: 190,
        endTurn: 240,
      })
      .mockResolvedValueOnce(null);
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          characterId: new ObjectId(),
          characterName: "Standing",
          party: "1",
          status: "active",
        },
        {
          _id: new ObjectId(),
          characterId: new ObjectId(),
          characterName: "Eliminated",
          party: "1",
          status: "withdrawn",
        },
      ]),
    } as never);
    db.collectionMocks.electionVoteTallies!.findOne.mockResolvedValue(null);
    db.collectionMocks.primarySnapshots!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryElectionDetail } = await import("./election");
    const result = await queryElectionDetail(db as unknown as Db, elecId.toString());

    expect(result!.candidates.map((c) => c.characterName)).toEqual(["Standing"]);
    expect(result!.formerCandidates.map((c) => c.characterName)).toEqual(["Eliminated"]);
    expect(result!.formerCandidates[0].status).toBe("withdrawn");
  });

  it("still names the incumbent after they lose their primary", async () => {
    const elecId = new ObjectId();
    const incumbentCharId = new ObjectId();
    db.collectionMocks
      .elections!.findOne.mockResolvedValueOnce({
        _id: elecId,
        seatId: "US-senate-CA-1",
        electionType: "senate",
        state: "CA",
        countryId: "US",
        cycle: 2,
        status: "active",
        totalSeats: 1,
        startTurn: 90,
        primaryEndTurn: 190,
        endTurn: 240,
      })
      .mockResolvedValueOnce({ winnerId: incumbentCharId.toString() });
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          characterId: incumbentCharId,
          characterName: "Sitting Senator",
          party: "1",
          status: "withdrawn",
        },
        {
          _id: new ObjectId(),
          characterId: new ObjectId(),
          characterName: "Challenger",
          party: "1",
          status: "active",
        },
      ]),
    } as never);
    db.collectionMocks.electionVoteTallies!.findOne.mockResolvedValue(null);
    db.collectionMocks.primarySnapshots!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryElectionDetail } = await import("./election");
    const result = await queryElectionDetail(db as unknown as Db, elecId.toString());

    // They hold the seat whether or not they are still on the ballot.
    expect(result!.incumbent).toEqual({ name: "Sitting Senator", party: "1" });
    expect(result!.candidates.map((c) => c.characterName)).toEqual(["Challenger"]);
  });

  describe("phase", () => {
    function seedActiveRace(overrides: Record<string, unknown> = {}) {
      const elecId = new ObjectId();
      db.collectionMocks
        .elections!.findOne.mockResolvedValueOnce({
          _id: elecId,
          seatId: "US-senate-CA-1",
          electionType: "senate",
          state: "CA",
          stateName: "California",
          countryId: "US",
          cycle: 2,
          status: "active",
          totalSeats: 1,
          startTurn: 90,
          primaryEndTurn: 190,
          endTurn: 240,
          startTime: new Date("2025-12-01T00:00:00Z"),
          primaryEndTime: new Date("2026-02-01T00:00:00Z"),
          endTime: new Date("2026-04-01T00:00:00Z"),
          ...overrides,
        })
        .mockResolvedValueOnce(null); // prior cycle lookup

      db.collectionMocks.electionCandidates!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      } as never);
      db.collectionMocks.electionVoteTallies!.findOne.mockResolvedValue(null);
      db.collectionMocks.primarySnapshots!.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      } as never);
      db.collectionMocks.politicalParties!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      } as never);
      return elecId;
    }

    it("flags inPrimary for an active race whose primary is still open", async () => {
      gameClock.currentTurn = 100;
      const elecId = seedActiveRace();

      const { queryElectionDetail } = await import("./election");
      const result = await queryElectionDetail(db as unknown as Db, elecId.toString());

      expect(result!.phase.inPrimary).toBe(true);
      expect(result!.phase.inGeneral).toBe(false);
      expect(result!.phase.current).toBe("primary");
    });

    it("flags inGeneral once the primary has closed", async () => {
      gameClock.currentTurn = 200;
      const elecId = seedActiveRace();

      const { queryElectionDetail } = await import("./election");
      const result = await queryElectionDetail(db as unknown as Db, elecId.toString());

      expect(result!.phase.inPrimary).toBe(false);
      expect(result!.phase.inGeneral).toBe(true);
      expect(result!.phase.current).toBe("general");
    });

    it("does not call votes final until the race has actually been resolved", async () => {
      gameClock.currentTurn = 250;
      const elecId = seedActiveRace();
      db.collectionMocks.electionVoteTallies!.findOne.mockResolvedValue({
        electionId: elecId,
        totalVotes: { char1: 500 },
      });

      const { queryElectionDetail } = await import("./election");
      const result = await queryElectionDetail(db as unknown as Db, elecId.toString());

      expect(result!.votes!.finalized).toBe(false);
    });

    it("does not place a cancelled race in any running phase", async () => {
      gameClock.currentTurn = 200;
      const elecId = seedActiveRace({ status: "cancelled" });

      const { queryElectionDetail } = await import("./election");
      const result = await queryElectionDetail(db as unknown as Db, elecId.toString());

      expect(result!.phase).toEqual({
        current: "cancelled",
        inPrimary: false,
        inGeneral: false,
        isUpcoming: false,
        isEnded: false,
      });
      expect(result!.election.phaseEndTurn).toBeNull();
      expect(result!.election.phaseEndTime).toBeNull();
    });

    it("exposes the turn bounds and the current phase deadline", async () => {
      gameClock.currentTurn = 100;
      const elecId = seedActiveRace();

      const { queryElectionDetail } = await import("./election");
      const result = await queryElectionDetail(db as unknown as Db, elecId.toString());

      expect(result!.election.primaryEndTurn).toBe(190);
      expect(result!.election.endTurn).toBe(240);
      expect(result!.election.phaseEndTurn).toBe(190);
      expect(result!.election.phaseEndTime).toBe("2026-02-01T00:00:00.000Z");
    });
  });
});

describe("queryElectionArchives", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    ["elections", "electionCandidates", "electionVoteTallies"].forEach((n) => db.collection(n));
  });

  it("returns archived elections with winner from the final tally", async () => {
    const electionId = new ObjectId();
    db.collection("elections").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: electionId,
          countryId: "US",
          electionType: "presidential",
          state: "national",
          status: "resolved",
          cycle: 5,
          totalSeats: 1,
          startTime: new Date("2026-01-01T00:00:00Z"),
          endTime: new Date("2026-02-01T00:00:00Z"),
        },
      ]),
    } as never);
    db.collection("electionCandidates").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collection("electionVoteTallies").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          electionId,
          totalVotes: { "507f1f77bcf86cd799439011": 400, "507f1f77bcf86cd799439012": 100 },
          candidateNames: { "507f1f77bcf86cd799439011": "Winner Name" },
          candidateParties: { "507f1f77bcf86cd799439011": "1" },
          finalized: true,
        },
      ]),
    } as never);

    const { queryElectionArchives } = await import("./election");
    const result = await queryElectionArchives(db as unknown as Db, { country: "US" });
    expect(result.found).toBe(true);
    const e = (result.elections as Record<string, unknown>[])[0];
    expect(e.status).toBe("resolved");
    expect(e.totalVotes).toBe(500);
    expect(e.winner).toEqual({ characterName: "Winner Name", party: "1", votes: 400 });
  });
});
