import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { PoliticalParty } from "@/lib/db/types";

vi.mock("@/lib/auth", () => ({ getAuthUserWithCharacter: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));

const characterId = new ObjectId();
const chairId = new ObjectId();

function makeParty(overrides: Partial<PoliticalParty> = {}): PoliticalParty {
  return {
    _id: new ObjectId(),
    sequentialId: 8,
    countryId: "UK",
    name: "The Revival Party",
    abbreviation: "TRP",
    color: "#123456",
    chairId,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    leadershipElectionMethod: "committee",
    ...overrides,
  } as unknown as PoliticalParty;
}

/** Member of the party, long-tenured, past every cooldown. */
async function mockViewer() {
  const { getAuthUserWithCharacter } = await import("@/lib/auth");
  vi.mocked(getAuthUserWithCharacter).mockResolvedValue({
    userId: new ObjectId().toString(),
    character: {
      _id: characterId,
      name: "Peggy O'Brian",
      party: "8",
      countryId: "UK",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      partyJoinedAt: new Date("2026-01-01T00:00:00Z"),
      partyJoinedTurn: 100,
    },
  } as never);
  const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
  vi.mocked(getCurrentTurn).mockResolvedValue(500);
}

function makeDb(): MockDb {
  const db = createMockDb();
  for (const name of [
    "nationalPartyElections",
    "nationalPartyCandidates",
    "nationalPartyVotes",
    "nationalCommitteeElections",
    "nationalCommitteeCandidates",
    "nationalCommitteeVotes",
    "characters",
    "users",
  ]) {
    db.collection(name);
  }
  // One open chair race, no candidates or votes yet.
  db.collectionMocks["nationalPartyElections"]!.find.mockReturnValue({
    toArray: async () => [
      {
        _id: new ObjectId(),
        partyId: "8",
        countryId: "UK",
        position: "chair",
        status: "voting",
        startTurn: 800,
        startTime: new Date("2026-11-01T00:00:00Z"),
        endTurn: 900,
        endTime: new Date("2026-12-01T00:00:00Z"),
      },
    ],
  } as never);
  db.collectionMocks["users"]!.findOne.mockResolvedValue({
    _id: new ObjectId(),
    createdAt: new Date("2025-01-01T00:00:00Z"),
  });
  return db;
}

describe("getNationalPartyElectionState — committee election method", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets a rank-and-file member stand for leadership under the committee method", async () => {
    // The election method decides who VOTES, not who runs: every method's
    // player-facing description is phrased as an electorate rule, and the
    // enter route enforces no method restriction at all. Ticket #1291 — a
    // two-person party with an empty committee left the only non-chair member
    // unable to contest any leadership seat, with a dead button and no reason.
    await mockViewer();
    const db = makeDb();

    const { getNationalPartyElectionState } = await import("./leadership");
    const state = await getNationalPartyElectionState(
      db as unknown as Db,
      makeParty({ committeeIds: [] })
    );

    expect(state.canRun).toBe(true);
  });

  it("still bars that member from voting under the committee method", async () => {
    await mockViewer();
    const db = makeDb();

    const { getNationalPartyElectionState } = await import("./leadership");
    const state = await getNationalPartyElectionState(
      db as unknown as Db,
      makeParty({ committeeIds: [] })
    );

    expect(state.canVote).toBe(false);
  });

  it("lets a committee member both run and vote", async () => {
    await mockViewer();
    const db = makeDb();

    const { getNationalPartyElectionState } = await import("./leadership");
    const state = await getNationalPartyElectionState(
      db as unknown as Db,
      makeParty({ committeeIds: [characterId] })
    );

    expect(state.canRun).toBe(true);
    expect(state.canVote).toBe(true);
  });

  it("leaves both open under the default all-members method", async () => {
    await mockViewer();
    const db = makeDb();

    const { getNationalPartyElectionState } = await import("./leadership");
    const state = await getNationalPartyElectionState(
      db as unknown as Db,
      makeParty({ leadershipElectionMethod: "party" })
    );

    expect(state.canRun).toBe(true);
    expect(state.canVote).toBe(true);
  });

  it("keeps the tenure gate biting a short-tenured member", async () => {
    // Removing the committee rule from canRun must not let an under-tenured
    // member through — that gate is separate and still applies.
    const { getAuthUserWithCharacter } = await import("@/lib/auth");
    vi.mocked(getAuthUserWithCharacter).mockResolvedValue({
      userId: new ObjectId().toString(),
      character: {
        _id: characterId,
        name: "Fresh Join",
        party: "8",
        countryId: "UK",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        partyJoinedAt: new Date("2026-01-01T00:00:00Z"),
        partyJoinedTurn: 495, // 5 turns served, short of 24
      },
    } as never);
    const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
    vi.mocked(getCurrentTurn).mockResolvedValue(500);
    const db = makeDb();

    const { getNationalPartyElectionState } = await import("./leadership");
    const state = await getNationalPartyElectionState(
      db as unknown as Db,
      makeParty({ leadershipElectionMethod: "party" })
    );

    expect(state.canRun).toBe(false);
    expect(state.canVote).toBe(false);
  });
});
