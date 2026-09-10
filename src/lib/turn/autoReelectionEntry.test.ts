import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character, ElectedOfficial, Election } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { runAutoReelectionEntry } from "./autoReelectionEntry";

// `findBlockingActiveCandidacy` is no longer called by this phase (#574), but
// three API routes still use it, so the module stays. Keep the REAL
// `electionStatusBlocksFurtherEntry` — the phase now imports it to decide which
// preloaded election statuses block entry, and a bare stub would return
// undefined and silently unblock everything.
vi.mock("@/lib/elections/activeCandidacy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/elections/activeCandidacy")>()),
  findBlockingActiveCandidacy: vi.fn(),
}));

function makeCursor<T>(docs: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
  };
}

describe("runAutoReelectionEntry", () => {
  let db: MockDb;
  let now: Date;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("characters");
    db.collection("electedOfficials");
    db.collection("elections");
    db.collection("electionCandidates");
    db.collectionMocks.electionCandidates.findOne.mockResolvedValue(null);
    const { findBlockingActiveCandidacy } = await import("@/lib/elections/activeCandidacy");
    vi.mocked(findBlockingActiveCandidacy).mockResolvedValue(null);
    now = new Date("2026-05-03T16:00:00Z");
  });

  it("only re-enters incumbents into the exact seat they are defending", async () => {
    const characterId = new ObjectId();
    const senateClassOneId = new ObjectId();
    const senateClassTwoId = new ObjectId();
    const governorId = new ObjectId();

    const character = {
      _id: characterId,
      userId: new ObjectId(),
      countryId: "US",
      name: "Ari Lane",
      homeState: "CA",
      party: "1",
      autoRunForReelection: true,
    } as Character;

    const heldSeat = {
      _id: new ObjectId(),
      characterId,
      officeType: "senate",
      state: "CA",
      senateClass: 1,
    } as ElectedOfficial;

    const matchingElection = {
      _id: senateClassOneId,
      countryId: "US",
      electionType: "senate",
      state: "CA",
      senateClass: 1,
      status: "active",
    } as Election;
    const wrongClassElection = {
      _id: senateClassTwoId,
      countryId: "US",
      electionType: "senate",
      state: "CA",
      senateClass: 2,
      status: "active",
    } as Election;
    const wrongOfficeElection = {
      _id: governorId,
      countryId: "US",
      electionType: "governor",
      state: "CA",
      status: "active",
    } as Election;

    db.collectionMocks.characters.find.mockReturnValue(makeCursor([character]));
    db.collectionMocks.electedOfficials.find.mockReturnValue(makeCursor([heldSeat]));
    db.collectionMocks.elections.find.mockReturnValue(
      makeCursor([matchingElection, wrongClassElection, wrongOfficeElection])
    );

    await runAutoReelectionEntry(db as unknown as Db, now, 1);

    expect(db.collectionMocks.electionCandidates.insertMany).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.electionCandidates.insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          electionId: senateClassOneId,
          characterId,
          characterName: "Ari Lane",
          status: "active",
        }),
      ],
      { ordered: false }
    );
  });

  it("matches snap elections using held elected seats even when currentOffice is non-elective", async () => {
    const characterId = new ObjectId();
    const snapElectionId = new ObjectId();

    const character = {
      _id: characterId,
      userId: new ObjectId(),
      countryId: "UK",
      name: "Rowan Price",
      homeState: "ENG",
      party: "7",
      currentOffice: { type: "ukCabinet", positionId: "chancellor" },
      autoRunForReelection: true,
    } as Character;

    const heldSeat = {
      _id: new ObjectId(),
      characterId,
      officeType: "commons",
      state: "ENG",
    } as ElectedOfficial;

    const snapElection = {
      _id: snapElectionId,
      countryId: "UK",
      electionType: "snap_commons",
      state: "ENG",
      status: "active",
    } as Election;

    db.collectionMocks.characters.find.mockReturnValue(makeCursor([character]));
    db.collectionMocks.electedOfficials.find.mockReturnValue(makeCursor([heldSeat]));
    db.collectionMocks.elections.find.mockReturnValue(makeCursor([snapElection]));

    await runAutoReelectionEntry(db as unknown as Db, now, 1);

    expect(db.collectionMocks.electionCandidates.insertMany).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.electionCandidates.insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          electionId: snapElectionId,
          characterId,
          characterName: "Rowan Price",
        }),
      ],
      { ordered: false }
    );
  });

  it("re-enters a loser into the most recently resolved seat they contested", async () => {
    const characterId = new ObjectId();
    const priorGovernorElectionId = new ObjectId();
    const priorSenateElectionId = new ObjectId();
    const nextGovernorElectionId = new ObjectId();
    const nextSenateElectionId = new ObjectId();

    const character = {
      _id: characterId,
      userId: new ObjectId(),
      countryId: "US",
      name: "Jamie Brooks",
      homeState: "CA",
      party: "3",
      autoRunForReelection: true,
    } as Character;

    db.collectionMocks.characters.find.mockReturnValue(makeCursor([character]));
    db.collectionMocks.electedOfficials.find.mockReturnValue(makeCursor([]));
    db.collectionMocks.electionCandidates.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          electionId: priorGovernorElectionId,
          characterId,
          characterName: "Jamie Brooks",
          party: "3",
          status: "withdrawn",
          withdrawnAt: new Date("2026-04-15T12:00:00Z"),
        },
        {
          _id: new ObjectId(),
          electionId: priorSenateElectionId,
          characterId,
          characterName: "Jamie Brooks",
          party: "3",
          status: "withdrawn",
          withdrawnAt: new Date("2026-03-15T12:00:00Z"),
        },
      ])
    );
    db.collectionMocks.elections.find
      .mockReturnValueOnce(
        makeCursor([
          {
            _id: priorGovernorElectionId,
            countryId: "US",
            electionType: "governor",
            state: "CA",
            status: "resolved",
            updatedAt: new Date("2026-04-15T12:00:00Z"),
          },
          {
            _id: priorSenateElectionId,
            countryId: "US",
            electionType: "senate",
            state: "CA",
            senateClass: 1,
            status: "resolved",
            updatedAt: new Date("2026-03-15T12:00:00Z"),
          },
        ])
      )
      .mockReturnValueOnce(
        makeCursor([
          {
            _id: nextGovernorElectionId,
            countryId: "US",
            electionType: "governor",
            state: "CA",
            status: "active",
          },
          {
            _id: nextSenateElectionId,
            countryId: "US",
            electionType: "senate",
            state: "CA",
            senateClass: 1,
            status: "active",
          },
        ])
      );
    db.collectionMocks.electionCandidates.findOne.mockResolvedValue(null);

    await runAutoReelectionEntry(db as unknown as Db, now, 1);

    expect(db.collectionMocks.electionCandidates.insertMany).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.electionCandidates.insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          electionId: nextGovernorElectionId,
          characterId,
          characterName: "Jamie Brooks",
        }),
      ],
      { ordered: false }
    );
  });

  it("does not re-enter a loser into an old seat after they relocate", async () => {
    const characterId = new ObjectId();
    const priorGovernorElectionId = new ObjectId();
    const nextGovernorElectionId = new ObjectId();

    const character = {
      _id: characterId,
      userId: new ObjectId(),
      countryId: "US",
      name: "Morgan Hale",
      homeState: "TX",
      party: "4",
      autoRunForReelection: true,
    } as Character;

    db.collectionMocks.characters.find.mockReturnValue(makeCursor([character]));
    db.collectionMocks.electedOfficials.find.mockReturnValue(makeCursor([]));
    db.collectionMocks.electionCandidates.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          electionId: priorGovernorElectionId,
          characterId,
          characterName: "Morgan Hale",
          party: "4",
          status: "withdrawn",
          withdrawnAt: new Date("2026-04-20T12:00:00Z"),
        },
      ])
    );
    db.collectionMocks.elections.find
      .mockReturnValueOnce(
        makeCursor([
          {
            _id: priorGovernorElectionId,
            countryId: "US",
            electionType: "governor",
            state: "CA",
            status: "resolved",
            updatedAt: new Date("2026-04-20T12:00:00Z"),
          },
        ])
      )
      .mockReturnValueOnce(
        makeCursor([
          {
            _id: nextGovernorElectionId,
            countryId: "US",
            electionType: "governor",
            state: "CA",
            status: "active",
          },
        ])
      );
    db.collectionMocks.electionCandidates.findOne.mockResolvedValue(null);

    await runAutoReelectionEntry(db as unknown as Db, now, 1);

    expect(db.collectionMocks.electionCandidates.insertMany).not.toHaveBeenCalled();
  });

  it("does not auto-enter players inactive for more than 96 turns", async () => {
    const characterId = new ObjectId();
    const userId = new ObjectId();
    const TURN_MS = 60 * 60 * 1000;
    const senateElectionId = new ObjectId();

    const character = {
      _id: characterId,
      userId,
      countryId: "US",
      name: "Stale Sam",
      homeState: "CA",
      party: "1",
      autoRunForReelection: true,
    } as Character;

    const heldSeat = {
      _id: new ObjectId(),
      characterId,
      officeType: "senate",
      state: "CA",
      senateClass: 1,
    } as ElectedOfficial;

    const election = {
      _id: senateElectionId,
      countryId: "US",
      electionType: "senate",
      state: "CA",
      senateClass: 1,
      status: "active",
    } as Election;

    db.collectionMocks.characters.find.mockReturnValue(makeCursor([character]));
    // User inactive for 200 turns → must be skipped by auto-reentry.
    db.collection("users").find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          { _id: userId, lastActivity: new Date(now.getTime() - 200 * TURN_MS) },
        ],
      }),
    });
    db.collectionMocks.electedOfficials.find.mockReturnValue(makeCursor([heldSeat]));
    db.collectionMocks.elections.find.mockReturnValue(makeCursor([election]));

    await runAutoReelectionEntry(db as unknown as Db, now, 1);

    expect(db.collectionMocks.electionCandidates.insertMany).not.toHaveBeenCalled();
  });

  it("does not auto-enter a banned-party character in an RU one-party-state race", async () => {
    const characterId = new ObjectId();
    const electionId = new ObjectId();

    const character = {
      _id: characterId,
      userId: new ObjectId(),
      countryId: "RU",
      name: "Luka az Koyotlya",
      homeState: "KAZ",
      party: "2",
      autoRunForReelection: true,
    } as Character;

    const heldSeat = {
      _id: new ObjectId(),
      characterId,
      officeType: "governor",
      state: "KAZ",
    } as ElectedOfficial;

    const election = {
      _id: electionId,
      countryId: "RU",
      electionType: "governor",
      state: "KAZ",
      status: "active",
    } as Election;

    db.collectionMocks.characters.find.mockReturnValue(makeCursor([character]));
    db.collectionMocks.electedOfficials.find.mockReturnValue(makeCursor([heldSeat]));
    db.collectionMocks.elections.find.mockReturnValue(makeCursor([election]));
    db.collection("politicalParties");
    db.collectionMocks.politicalParties.find.mockReturnValue(
      makeCursor([{ sequentialId: 2, countryId: "RU", regimeStatus: "banned" }])
    );

    await runAutoReelectionEntry(db as unknown as Db, now, 1);

    expect(db.collectionMocks.electionCandidates.insertMany).not.toHaveBeenCalled();
  });

  // ── Batched-read behaviour (#574) ──────────────────────────────────────────
  // The phase used to issue ~3 awaited round trips per eligible character.
  // These pin the decisions that moved into memory, plus the query count.
  describe("batched reads", () => {
    const characterId = new ObjectId();
    const seatElectionId = new ObjectId();
    const otherOpenElectionId = new ObjectId();

    const character = {
      _id: characterId,
      userId: new ObjectId(),
      countryId: "US",
      name: "Ari Lane",
      homeState: "CA",
      party: "1",
      autoRunForReelection: true,
    } as Character;

    const heldSeat = {
      _id: new ObjectId(),
      characterId,
      officeType: "governor",
      state: "CA",
    } as ElectedOfficial;

    const seatElection = {
      _id: seatElectionId,
      countryId: "US",
      electionType: "governor",
      state: "CA",
      status: "active",
    } as Election;

    /**
     * `elections.find` is called twice now — once for the blocking-status
     * preload, once for the active/upcoming set — so route by filter shape
     * rather than returning one fixed cursor to both.
     */
    function wireElections(openSet: Election[], statusRows: Partial<Election>[]) {
      db.collectionMocks.elections.find.mockImplementation((filter: Record<string, unknown>) => {
        const byId = (filter as { _id?: { $in?: unknown[] } })._id?.$in;
        if (byId) return makeCursor(statusRows);
        return makeCursor(openSet);
      });
    }

    beforeEach(() => {
      db.collectionMocks.characters.find.mockReturnValue(makeCursor([character]));
      db.collectionMocks.electedOfficials.find.mockReturnValue(makeCursor([heldSeat]));
    });

    it("skips a character already entered in this election", async () => {
      db.collectionMocks.electionCandidates.find.mockReturnValue(
        makeCursor([{ electionId: seatElectionId, characterId, status: "active" }])
      );
      wireElections([seatElection], [{ _id: seatElectionId, status: "active" }]);

      await runAutoReelectionEntry(db as unknown as Db, now, 1);

      expect(db.collectionMocks.electionCandidates.insertMany).not.toHaveBeenCalled();
    });

    it("skips a character holding an active candidacy in another still-open race", async () => {
      db.collectionMocks.electionCandidates.find.mockReturnValue(
        makeCursor([{ electionId: otherOpenElectionId, characterId, status: "active" }])
      );
      wireElections([seatElection], [{ _id: otherOpenElectionId, status: "active" }]);

      await runAutoReelectionEntry(db as unknown as Db, now, 1);

      expect(db.collectionMocks.electionCandidates.insertMany).not.toHaveBeenCalled();
    });

    it("enters a character whose only other candidacy sits in a resolved race", async () => {
      db.collectionMocks.electionCandidates.find.mockReturnValue(
        makeCursor([{ electionId: otherOpenElectionId, characterId, status: "active" }])
      );
      // `resolved` is not a blocking status, so it must not gate entry.
      wireElections([seatElection], [{ _id: otherOpenElectionId, status: "resolved" }]);

      await runAutoReelectionEntry(db as unknown as Db, now, 1);

      expect(db.collectionMocks.electionCandidates.insertMany).toHaveBeenCalledTimes(1);
    });

    it("issues no per-character lookups", async () => {
      db.collectionMocks.electionCandidates.find.mockReturnValue(makeCursor([]));
      wireElections([seatElection], []);

      await runAutoReelectionEntry(db as unknown as Db, now, 1);

      expect(db.collectionMocks.electionCandidates.findOne).not.toHaveBeenCalled();
      expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
    });

    // The old code inserted one row at a time, so a second election sharing the
    // seat key saw the first entry and skipped it. The in-memory bookkeeping
    // has to reproduce that.
    it("enters a character once when two open elections share the same seat", async () => {
      const duplicateElection = { ...seatElection, _id: new ObjectId() } as Election;
      db.collectionMocks.electionCandidates.find.mockReturnValue(makeCursor([]));
      wireElections([seatElection, duplicateElection], []);

      await runAutoReelectionEntry(db as unknown as Db, now, 1);

      expect(db.collectionMocks.electionCandidates.insertMany).toHaveBeenCalledTimes(1);
      expect(db.collectionMocks.electionCandidates.insertMany).toHaveBeenCalledWith(
        [expect.objectContaining({ electionId: seatElectionId, characterId })],
        { ordered: false }
      );
    });
  });
});
