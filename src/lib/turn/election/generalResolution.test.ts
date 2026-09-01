/**
 * Unit tests for resolveOneGeneralElection — the core function that determines
 * election winners, writes elected officials, sends notifications, and spawns the
 * next election cycle.
 *
 * Each test mounts a minimal MockDb wired to the function under test. All
 * external side-effect modules are mocked so the database interaction can be
 * asserted precisely.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Election, ElectionVoteTally } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/wiki/updatePoliticianPageOnElection", () => ({
  updatePoliticianPagesAfterElection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/congress/leadershipElections", () => ({
  triggerLeadershipElectionsAfterChamberVote: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/election/presidentResolution", () => ({
  resolvePresidentElection: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/turn/election/electionSpawning", () => ({
  spawnHouseElection: vi.fn().mockResolvedValue(undefined),
  spawnCommonsElection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/partyOrg", () => ({
  updatePartyPresence: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn(),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(new ObjectId()),
}));
vi.mock("@/lib/achievements/triggers", () => ({
  checkElectionWinAchievements: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date("2025-11-15T00:00:00Z");
const CURRENT_TURN = 20;

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

function makeElection(overrides: Partial<Election> = {}): Election {
  return {
    _id: new ObjectId(),
    countryId: "US",
    electionType: "senate",
    state: "CA",
    cycle: 1,
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Election;
}

function makeTally(
  electionId: ObjectId,
  totalVotes: Record<string, number>,
  overrides: Partial<ElectionVoteTally> = {}
): ElectionVoteTally {
  return {
    _id: new ObjectId(),
    electionId,
    state: "CA",
    totalVotes,
    candidateNames: {},
    candidateParties: {},
    turnSnapshots: [],
    finalized: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as ElectionVoteTally;
}

function makeCandidate(
  electionId: ObjectId,
  overrides: {
    isNPP?: boolean;
    nppId?: ObjectId;
    characterId?: ObjectId;
    party?: string;
    characterName?: string;
  } = {}
) {
  const id = new ObjectId();
  return {
    _id: id,
    electionId,
    characterId: overrides.isNPP ? undefined : (overrides.characterId ?? new ObjectId()),
    characterName: overrides.characterName ?? "Test Candidate",
    party: overrides.party ?? "DEM",
    status: "active",
    isNPP: overrides.isNPP ?? false,
    nppId: overrides.nppId,
    enteredAt: NOW,
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

let db: MockDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();

  // Pre-init all collections touched by the function
  for (const name of [
    "elections",
    "electionVoteTallies",
    "electionCandidates",
    "electedOfficials",
    "characters",
    "npps",
    "campaigns",
    "statePartyOrg",
  ]) {
    db.collection(name);
  }

  // Default: no candidates found when querying by ID
  db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([]));
  db.collectionMocks["characters"]!.find.mockReturnValue(makeCursor([]));
  db.collectionMocks["npps"]!.find.mockReturnValue(makeCursor([]));
  db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue(null);
});

// ── resolveOneGeneralElection ─────────────────────────────────────────────────

describe("resolveOneGeneralElection", () => {
  // ── Edge case: already-finalized tally ──────────────────────────────────────

  it("recovers gracefully when tally is already finalized — marks election resolved without re-writing officials", async () => {
    const election = makeElection({ electionType: "senate", state: "CA" });
    const tally = makeTally(election._id, {}, { finalized: true });

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      tally,
      CURRENT_TURN,
      NOW
    );

    expect(result.resolved).toBe(true);
    expect(result.newsOutcomes).toHaveLength(0);

    // Should mark the election resolved
    expect(db.collectionMocks["elections"]!.updateOne).toHaveBeenCalledWith(
      { _id: election._id },
      expect.objectContaining({ $set: expect.objectContaining({ status: "resolved" }) })
    );

    // Should NOT write any elected officials (already done in a prior turn)
    expect(db.collectionMocks["electedOfficials"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["electedOfficials"]!.insertOne).not.toHaveBeenCalled();
  });

  it("spawns next house election cycle when recovering a finalized house tally", async () => {
    const election = makeElection({ electionType: "house", state: "CA" });
    const tally = makeTally(election._id, {}, { finalized: true });

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    const { spawnHouseElection } = await import("@/lib/turn/election/electionSpawning");
    expect(spawnHouseElection).toHaveBeenCalledWith(db, election, NOW);
  });

  it("spawns next commons cycle when recovering a finalized commons tally", async () => {
    const election = makeElection({ electionType: "commons", state: "Bristol North West" });
    const tally = makeTally(election._id, {}, { finalized: true });

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    const { spawnCommonsElection } = await import("@/lib/turn/election/electionSpawning");
    expect(spawnCommonsElection).toHaveBeenCalledWith(db, election, NOW);
  });

  // ── Edge case: no tally ───────────────────────────────────────────────────

  it("marks election resolved (not a win) when tally is null", async () => {
    const election = makeElection({ electionType: "senate", state: "TX" });

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      null,
      CURRENT_TURN,
      NOW
    );

    expect(result.resolved).toBe(false);
    expect(db.collectionMocks["elections"]!.updateOne).toHaveBeenCalledWith(
      { _id: election._id },
      expect.objectContaining({ $set: expect.objectContaining({ status: "resolved" }) })
    );
    // No officials written
    expect(db.collectionMocks["electedOfficials"]!.updateOne).not.toHaveBeenCalled();
  });

  it("clears commons officials and spawns next race when tally is null", async () => {
    const election = makeElection({
      electionType: "commons",
      state: "Bristol West",
      countryId: "UK",
    });

    // sweepStaleOffice reads electedOfficials — return empty so no sweep updates fire
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(makeCursor([]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, null, CURRENT_TURN, NOW);

    // Should delete old officials for this constituency
    expect(db.collectionMocks["electedOfficials"]!.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ officeType: "commons", state: "Bristol West" })
    );

    const { spawnCommonsElection } = await import("@/lib/turn/election/electionSpawning");
    expect(spawnCommonsElection).toHaveBeenCalledWith(db, election, NOW);
  });

  it("reopens House leadership and spawns the next cycle when a House election resolves with no tally", async () => {
    const election = makeElection({ electionType: "house", state: "CA-12" });

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, null, CURRENT_TURN, NOW);

    const { spawnHouseElection } = await import("@/lib/turn/election/electionSpawning");
    const { triggerLeadershipElectionsAfterChamberVote } =
      await import("@/lib/congress/leadershipElections");
    expect(spawnHouseElection).toHaveBeenCalledWith(db, election, NOW);
    expect(triggerLeadershipElectionsAfterChamberVote).toHaveBeenCalledWith(db, "house", NOW);
  });

  // ── Edge case: zero votes ─────────────────────────────────────────────────

  it("finalizes tally and withdraws candidates when totalVotes sums to 0", async () => {
    const election = makeElection({ electionType: "senate", state: "OR", senateClass: 1 });
    const candidateId = new ObjectId().toString();
    const tally = makeTally(election._id, { [candidateId]: 0 });

    // No matching candidate in DB
    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      tally,
      CURRENT_TURN,
      NOW
    );

    expect(result.resolved).toBe(true);
    expect(db.collectionMocks["electionVoteTallies"]!.updateOne).toHaveBeenCalledWith(
      { electionId: election._id },
      expect.objectContaining({ $set: expect.objectContaining({ finalized: true }) })
    );
    expect(db.collectionMocks["electionCandidates"]!.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ electionId: election._id, status: "active" }),
      expect.objectContaining({ $set: expect.objectContaining({ status: "withdrawn" }) })
    );
  });

  it("triggers leadership elections after zero-vote senate resolve", async () => {
    const election = makeElection({ electionType: "senate", state: "OR", senateClass: 1 });
    const tally = makeTally(election._id, {});
    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    const { triggerLeadershipElectionsAfterChamberVote } =
      await import("@/lib/congress/leadershipElections");
    expect(triggerLeadershipElectionsAfterChamberVote).toHaveBeenCalledWith(db, "senate", NOW);
  });

  it("triggers leadership elections and spawns next cycle after zero-vote house resolve", async () => {
    const election = makeElection({ electionType: "house", state: "CA-12" });
    const tally = makeTally(election._id, {});
    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    const { spawnHouseElection } = await import("@/lib/turn/election/electionSpawning");
    const { triggerLeadershipElectionsAfterChamberVote } =
      await import("@/lib/congress/leadershipElections");
    expect(spawnHouseElection).toHaveBeenCalledWith(db, election, NOW);
    expect(triggerLeadershipElectionsAfterChamberVote).toHaveBeenCalledWith(db, "house", NOW);
  });

  it("triggers Senate leadership elections when no ranked candidates remain", async () => {
    const election = makeElection({ electionType: "senate", state: "OR", senateClass: 1 });
    const tally = makeTally(election._id, { [new ObjectId().toString()]: 25 });
    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    const { triggerLeadershipElectionsAfterChamberVote } =
      await import("@/lib/congress/leadershipElections");
    expect(triggerLeadershipElectionsAfterChamberVote).toHaveBeenCalledWith(db, "senate", NOW);
  });

  it("triggers House leadership elections when no ranked candidates remain", async () => {
    const election = makeElection({ electionType: "house", state: "CA-12" });
    const tally = makeTally(election._id, { [new ObjectId().toString()]: 25 });
    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    const { spawnHouseElection } = await import("@/lib/turn/election/electionSpawning");
    const { triggerLeadershipElectionsAfterChamberVote } =
      await import("@/lib/congress/leadershipElections");
    expect(spawnHouseElection).toHaveBeenCalledWith(db, election, NOW);
    expect(triggerLeadershipElectionsAfterChamberVote).toHaveBeenCalledWith(db, "house", NOW);
  });

  // ── Snapshot recovery ────────────────────────────────────────────────────────

  it("recovers votes from the last turn snapshot when totalVotes is empty", async () => {
    const election = makeElection({ electionType: "senate", state: "PA" });

    // The tally keys are candidate document _id values (not characterId).
    // Create the candidate first so we can use its _id as the tally key.
    const characterId = new ObjectId();
    const candidateDocId = new ObjectId();
    const candidateDocIdStr = candidateDocId.toString();

    const tally = makeTally(
      election._id,
      {},
      {
        totalVotes: {}, // empty — should trigger snapshot recovery
        turnSnapshots: [
          {
            turn: 19,
            recordedAt: NOW,
            cumulativeVotes: { [candidateDocIdStr]: 500 },
            sharesPct: {},
          },
          {
            turn: 20,
            recordedAt: NOW,
            cumulativeVotes: { [candidateDocIdStr]: 1000 }, // last snapshot has the votes
            sharesPct: {},
          },
        ],
      }
    );

    // Candidate _id must match the tally key so the candidateMap lookup succeeds.
    const candidate = {
      _id: candidateDocId,
      electionId: election._id,
      characterId,
      characterName: "Recovery Candidate",
      party: "DEM",
      status: "active",
      isNPP: false,
      enteredAt: NOW,
    };

    const userId = new ObjectId();
    const character = { _id: characterId, userId, favorability: 55 };

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([candidate]));
    db.collectionMocks["characters"]!.find.mockReturnValue(makeCursor([character]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      tally,
      CURRENT_TURN,
      NOW
    );

    expect(result.resolved).toBe(true);
    // Election should be resolved and a winner written (1000 votes recovered from snapshot)
    expect(db.collectionMocks["elections"]!.updateOne).toHaveBeenCalledWith(
      { _id: election._id },
      expect.objectContaining({ $set: expect.objectContaining({ status: "resolved" }) })
    );
    // Winner should update characters currentOffice
    expect(db.collectionMocks["characters"]!.updateOne).toHaveBeenCalledWith(
      { _id: characterId },
      expect.objectContaining({
        $set: expect.objectContaining({
          currentOffice: expect.objectContaining({ type: "senate" }),
        }),
      })
    );
  });

  // ── Single-seat election resolution ─────────────────────────────────────────

  it("single-seat senate election: top vote-getter wins, loser's office is vacated", async () => {
    const election = makeElection({ electionType: "senate", state: "PA" });

    const winnerId = new ObjectId();
    const loserId = new ObjectId();
    const winnerTallyKey = winnerId.toString();
    const loserTallyKey = loserId.toString();

    const tally = makeTally(election._id, {
      [winnerTallyKey]: 1200,
      [loserTallyKey]: 800,
    });

    const winner = makeCandidate(election._id, {
      characterId: winnerId,
      party: "DEM",
      characterName: "Alice Winner",
    });
    winner._id = new ObjectId(winnerTallyKey);

    const loser = makeCandidate(election._id, {
      characterId: loserId,
      party: "GOP",
      characterName: "Bob Loser",
    });
    loser._id = new ObjectId(loserTallyKey);

    const winnerUserId = new ObjectId();
    const loserUserId = new ObjectId();
    const winnerChar = { _id: winnerId, userId: winnerUserId, favorability: 60 };
    const loserChar = { _id: loserId, userId: loserUserId, favorability: 45 };

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([winner, loser]));
    db.collectionMocks["characters"]!.find.mockReturnValue(makeCursor([winnerChar, loserChar]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      tally,
      CURRENT_TURN,
      NOW
    );

    expect(result.resolved).toBe(true);
    expect(result.newsOutcomes).toHaveLength(1);
    expect(result.newsOutcomes[0].winnerName).toBe("Alice Winner");
    expect(result.newsOutcomes[0].isPlayer).toBe(true);

    // Winner: currentOffice set, careerHistory pushed
    const charUpdateCalls = db.collectionMocks["characters"]!.updateOne.mock.calls;
    const winnerSetCall = charUpdateCalls.find(
      (c) => c[0]?._id?.toString() === winnerId.toString() && c[1]?.$set?.currentOffice
    );
    expect(winnerSetCall).toBeDefined();
    expect(winnerSetCall![1].$set.currentOffice).toMatchObject({
      type: "senate",
      state: "PA",
    });

    // Loser: office vacated if they currently hold it
    const loserVacateCall = charUpdateCalls.find(
      (c) =>
        c[0]?._id?.toString() === loserId.toString() && c[0]?.["currentOffice.type"] === "senate"
    );
    expect(loserVacateCall).toBeDefined();
    expect(loserVacateCall![1].$set.currentOffice).toBeNull();

    // Tally finalized
    expect(db.collectionMocks["electionVoteTallies"]!.updateOne).toHaveBeenCalledWith(
      { electionId: election._id },
      expect.objectContaining({ $set: expect.objectContaining({ finalized: true }) })
    );

    // Election resolved
    expect(db.collectionMocks["elections"]!.updateOne).toHaveBeenCalledWith(
      { _id: election._id },
      expect.objectContaining({ $set: expect.objectContaining({ status: "resolved" }) })
    );

    // Ticket #826 item 11: any still-pending debate challenge tied to this
    // election must be voided (not left to resolve on its own 12h real-time
    // deadline, well after the race is over).
    expect(db.collectionMocks["debateSessions"]!.updateMany).toHaveBeenCalledWith(
      { electionId: election._id, status: "awaitingStrategies" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "expired", resolveReason: "election_ended" }),
      })
    );

    // Campaigns cleaned up
    expect(db.collectionMocks["campaigns"]!.deleteMany).toHaveBeenCalledWith({
      electionId: election._id,
    });
  });

  it("seats an Irish uachtaran winner and clears the previous office holder", async () => {
    const election = makeElection({
      countryId: "IE",
      electionType: "uachtaran",
      state: "IE",
      totalSeats: 1,
    });
    const incumbentId = new ObjectId();
    const winnerNppId = new ObjectId();
    const candidateId = new ObjectId();
    const tally = makeTally(election._id, { [candidateId.toString()]: 1_000 });
    const candidate = makeCandidate(election._id, {
      isNPP: true,
      nppId: winnerNppId,
      party: "fianna_fail",
      characterName: "New Uachtaran",
    });
    candidate._id = candidateId;

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([candidate]));
    db.collectionMocks["npps"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: winnerNppId,
          countryId: "IE",
          name: "New Uachtaran",
          currentOffice: null,
        },
      ])
    );
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      countryId: "IE",
      officeType: "uachtaran",
      state: "IE",
      nppId: incumbentId,
      characterName: "Outgoing Uachtaran",
      party: "fine_gael",
      isNPP: true,
    });

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      tally,
      CURRENT_TURN,
      NOW
    );

    expect(result.resolved).toBe(true);
    expect(db.collectionMocks["npps"]!.updateOne).toHaveBeenCalledWith(
      {
        _id: incumbentId,
        "currentOffice.type": "uachtaran",
        "currentOffice.state": "IE",
      },
      { $set: { currentOffice: null, updatedAt: NOW } }
    );
    expect(db.collectionMocks["npps"]!.updateOne).toHaveBeenCalledWith(
      { _id: winnerNppId },
      {
        $set: {
          currentOffice: { type: "uachtaran", state: "IE", seatsHeld: 1 },
          party: "fianna_fail",
          updatedAt: NOW,
        },
      }
    );
    expect(db.collectionMocks["electedOfficials"]!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "IE",
        officeType: "uachtaran",
        state: "IE",
        nppId: winnerNppId,
        isNPP: true,
      })
    );
  });

  it("winner notification is sent to the winning character's user", async () => {
    const election = makeElection({ electionType: "senate", state: "FL" });
    const winnerId = new ObjectId();
    const winnerTallyKey = winnerId.toString();
    const tally = makeTally(election._id, { [winnerTallyKey]: 500 });

    const winner = makeCandidate(election._id, {
      characterId: winnerId,
      party: "DEM",
      characterName: "Jane",
    });
    winner._id = new ObjectId(winnerTallyKey);

    const userId = new ObjectId();
    const winnerChar = { _id: winnerId, userId };

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([winner]));
    db.collectionMocks["characters"]!.find.mockReturnValue(makeCursor([winnerChar]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    const { createNotifications } = await import("@/lib/notifications");
    const batched = vi.mocked(createNotifications).mock.calls.flatMap((c) => c[0]);
    expect(batched).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId, type: "general_win" })])
    );
  });

  it("loss notification sent to the losing character; lost_election pushed to career history", async () => {
    const election = makeElection({ electionType: "senate", state: "OH" });
    const winnerId = new ObjectId();
    const loserId = new ObjectId();
    const winnerKey = winnerId.toString();
    const loserKey = loserId.toString();
    const tally = makeTally(election._id, { [winnerKey]: 900, [loserKey]: 400 });

    const winner = makeCandidate(election._id, {
      characterId: winnerId,
      party: "DEM",
      characterName: "Winner",
    });
    winner._id = new ObjectId(winnerKey);
    const loser = makeCandidate(election._id, {
      characterId: loserId,
      party: "GOP",
      characterName: "Loser",
    });
    loser._id = new ObjectId(loserKey);

    const loserUserId = new ObjectId();
    const loserChar = { _id: loserId, userId: loserUserId };
    const winnerChar = { _id: winnerId, userId: new ObjectId() };

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([winner, loser]));
    db.collectionMocks["characters"]!.find.mockReturnValue(makeCursor([winnerChar, loserChar]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    const { createNotifications } = await import("@/lib/notifications");
    const batched = vi.mocked(createNotifications).mock.calls.flatMap((c) => c[0]);
    expect(batched).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: loserUserId, type: "general_loss" }),
      ])
    );

    // lost_election pushed to career history
    const charUpdateCalls = db.collectionMocks["characters"]!.updateOne.mock.calls;
    const careerPush = charUpdateCalls.find(
      (c) =>
        c[0]?._id?.toString() === loserId.toString() &&
        c[1]?.$push?.careerHistory?.type === "lost_election"
    );
    expect(careerPush).toBeDefined();
  });

  // ── Incumbent clearing ───────────────────────────────────────────────────────

  it("clears incumbent character's currentOffice when a different candidate wins the seat", async () => {
    const election = makeElection({ electionType: "senate", state: "AZ" });
    const incumbentCharId = new ObjectId();
    const newWinnerId = new ObjectId();
    const winnerKey = newWinnerId.toString();
    const tally = makeTally(election._id, { [winnerKey]: 600 });

    const newWinner = makeCandidate(election._id, {
      characterId: newWinnerId,
      party: "DEM",
      characterName: "New Senator",
    });
    newWinner._id = new ObjectId(winnerKey);

    // Incumbent holds this seat
    const incumbent = {
      _id: new ObjectId(),
      officeType: "senate",
      state: "AZ",
      characterId: incumbentCharId,
      characterName: "Old Senator",
      party: "GOP",
      isNPP: false,
    };
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue(incumbent);

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([newWinner]));
    db.collectionMocks["characters"]!.find.mockReturnValue(makeCursor([]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    // Incumbent's currentOffice should be cleared
    const charUpdateCalls = db.collectionMocks["characters"]!.updateOne.mock.calls;
    const incumbentClear = charUpdateCalls.find(
      (c) =>
        c[0]?._id?.toString() === incumbentCharId.toString() && c[1]?.$set?.currentOffice === null
    );
    expect(incumbentClear).toBeDefined();
  });

  it("does NOT clear currentOffice when the same character wins re-election to the same seat", async () => {
    const election = makeElection({ electionType: "senate", state: "TX" });
    const charId = new ObjectId();
    const candKey = charId.toString();
    const tally = makeTally(election._id, { [candKey]: 800 });

    const candidate = makeCandidate(election._id, {
      characterId: charId,
      party: "GOP",
      characterName: "Incumbent",
    });
    candidate._id = new ObjectId(candKey);

    // Same person is the incumbent
    const incumbent = {
      _id: new ObjectId(),
      officeType: "senate",
      state: "TX",
      characterId: charId, // same character
      isNPP: false,
    };
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue(incumbent);
    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([candidate]));
    db.collectionMocks["characters"]!.find.mockReturnValue(makeCursor([]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    // Should NOT have cleared the incumbent's office
    const charUpdateCalls = db.collectionMocks["characters"]!.updateOne.mock.calls;
    const incumbentClear = charUpdateCalls.find(
      (c) =>
        c[0]?._id?.toString() === charId.toString() &&
        c[1]?.$set?.currentOffice === null &&
        !c[0]?.["currentOffice.type"] // only the explicit-clear path (not loser vacate)
    );
    expect(incumbentClear).toBeUndefined();
  });

  // ── NPP winner ────────────────────────────────────────────────────────────

  it("retains a selected Commons constituency when an MP wins re-election in the same region", async () => {
    const election = makeElection({ countryId: "UK", electionType: "commons", state: "NEE" });
    const charId = new ObjectId();
    const candidateKey = charId.toString();
    const tally = makeTally(election._id, { [candidateKey]: 800 });

    const candidate = makeCandidate(election._id, {
      characterId: charId,
      party: "1",
      characterName: "Returning MP",
    });
    candidate._id = new ObjectId(candidateKey);

    const currentOffice = {
      type: "commons",
      state: "NEE",
      seatsHeld: 1,
      constituency: "Newcastle upon Tyne Central and West",
      constituencyId: "E14001384",
    };

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([candidate]));
    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([{ _id: charId, userId: new ObjectId(), currentOffice }])
    );

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    const charUpdateCalls = db.collectionMocks["characters"]!.updateOne.mock.calls;
    const winnerSetCall = charUpdateCalls.find(
      (c) => c[0]?._id?.toString() === charId.toString() && c[1]?.$set?.currentOffice
    );
    expect(winnerSetCall![1].$set.currentOffice).toMatchObject({
      type: "commons",
      state: "NEE",
      constituency: "Newcastle upon Tyne Central and West",
      constituencyId: "E14001384",
    });
    expect(winnerSetCall![1].$push.careerHistory.officeLabel).toBe(
      "Member of Parliament for Newcastle upon Tyne Central and West"
    );

    const officialInsert = db.collectionMocks["electedOfficials"]!.insertOne.mock.calls.find(
      (c) => c[0]?.officeType === "commons" && c[0]?.characterId?.toString() === charId.toString()
    );
    expect(officialInsert![0]).toMatchObject({
      constituency: "Newcastle upon Tyne Central and West",
      constituencyId: "E14001384",
    });
  });

  it("clears seatsHeld when a multi-seat holder vacates a prior bloc to win a different seat (no party:null orphan) — #951", async () => {
    // Winner currently holds a 14-seat commons bloc in NEE, then wins commons in
    // SEE. The old NEE bloc must be fully vacated: nulling only the holder while
    // leaving seatsHeld would strand a `party:null seatsHeld>0` orphan that the
    // seat tallies skip, silently deleting the party's representation.
    const election = makeElection({ countryId: "UK", electionType: "commons", state: "SEE" });
    const charId = new ObjectId();
    const candidateKey = charId.toString();
    const tally = makeTally(election._id, { [candidateKey]: 800 });

    const candidate = makeCandidate(election._id, {
      characterId: charId,
      party: "2",
      characterName: "Moving MP",
    });
    candidate._id = new ObjectId(candidateKey);

    const currentOffice = { type: "commons", state: "NEE", seatsHeld: 14 };

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([candidate]));
    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([{ _id: charId, userId: new ObjectId(), currentOffice }])
    );

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    const vacateCall = db.collectionMocks["electedOfficials"]!.updateMany.mock.calls.find(
      (c) => c[0]?.characterId?.toString() === charId.toString()
    );
    expect(vacateCall, "expected a vacate updateMany for the moving MP").toBeDefined();
    expect(vacateCall![1].$set).toMatchObject({ party: undefined, isNPP: false });
    expect(vacateCall![1].$unset).toMatchObject({ seatsHeld: "" });
  });

  it("preserves a sitting national executive's currentOffice when they win a legislative seat", async () => {
    const election = makeElection({ countryId: "JP", electionType: "shugiin", state: "tokyo" });
    const charId = new ObjectId();
    const candidateKey = charId.toString();
    const tally = makeTally(election._id, { [candidateKey]: 800 });

    const candidate = makeCandidate(election._id, {
      characterId: charId,
      party: "LDP",
      characterName: "PM Candidate",
    });
    candidate._id = new ObjectId(candidateKey);

    const currentOffice = {
      type: "primeMinister",
      state: "osaka",
      constituency: "Osaka 1",
      constituencyId: "osaka-1",
    };

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([candidate]));
    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([{ _id: charId, userId: new ObjectId(), currentOffice }])
    );

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    const charUpdateCalls = db.collectionMocks["characters"]!.updateOne.mock.calls;
    const winnerSetCall = charUpdateCalls.find(
      (c) => c[0]?._id?.toString() === charId.toString() && c[1]?.$set?.currentOffice
    );
    // PM keeps their executive office type but adopts the new constituency.
    expect(winnerSetCall![1].$set.currentOffice).toMatchObject({
      type: "primeMinister",
      state: "tokyo",
    });

    // The legislative seat is still recorded in electedOfficials.
    const officialInsert = db.collectionMocks["electedOfficials"]!.insertOne.mock.calls.find(
      (c) => c[0]?.officeType === "shugiin" && c[0]?.characterId?.toString() === charId.toString()
    );
    expect(officialInsert![0]).toMatchObject({
      officeType: "shugiin",
      state: "tokyo",
    });
  });

  it("NPP winner gets currentOffice updated on npps collection, not characters", async () => {
    const election = makeElection({ electionType: "senate", state: "IA" });
    const nppId = new ObjectId();
    const candId = new ObjectId();
    const candKey = candId.toString();
    const tally = makeTally(election._id, { [candKey]: 700 });

    const nppCandidate = {
      _id: candId,
      electionId: election._id,
      characterId: undefined,
      characterName: "NPP Senator",
      party: "DEM",
      status: "active",
      isNPP: true,
      nppId,
      enteredAt: NOW,
    };

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([nppCandidate]));
    db.collectionMocks["npps"]!.find.mockReturnValue(
      makeCursor([{ _id: nppId, currentOffice: null }])
    );

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      tally,
      CURRENT_TURN,
      NOW
    );

    expect(result.resolved).toBe(true);
    expect(result.newsOutcomes[0]?.isPlayer).toBe(false);

    // NPP updated
    expect(db.collectionMocks["npps"]!.updateOne).toHaveBeenCalledWith(
      { _id: nppId },
      expect.objectContaining({
        $set: expect.objectContaining({
          currentOffice: expect.objectContaining({ type: "senate" }),
        }),
      })
    );

    // Characters NOT updated for the winner
    const charUpdateCalls = db.collectionMocks["characters"]!.updateOne.mock.calls;
    const winnerCharUpdate = charUpdateCalls.find(
      (c) => c[1]?.$set?.currentOffice?.type === "senate"
    );
    expect(winnerCharUpdate).toBeUndefined();

    // No win notification (NPPs don't get notified)
    const { createNotifications } = await import("@/lib/notifications");
    const batched = vi.mocked(createNotifications).mock.calls.flatMap((c) => c[0]);
    expect(batched).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "general_win" })])
    );
  });

  // ── Multi-seat election (house) ──────────────────────────────────────────

  it("house election clears existing officials before writing new seats", async () => {
    const election = makeElection({
      electionType: "house",
      state: "CA-12",
      totalSeats: 10,
    });

    const cand1Id = new ObjectId();
    const cand2Id = new ObjectId();
    const tally = makeTally(election._id, {
      [cand1Id.toString()]: 6000,
      [cand2Id.toString()]: 4000,
    });

    const cand1 = makeCandidate(election._id, {
      characterId: cand1Id,
      party: "DEM",
      characterName: "Candidate A",
    });
    cand1._id = new ObjectId(cand1Id.toString());

    const cand2 = makeCandidate(election._id, {
      characterId: cand2Id,
      party: "GOP",
      characterName: "Candidate B",
    });
    cand2._id = new ObjectId(cand2Id.toString());

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([cand1, cand2]));
    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([
        { _id: cand1Id, userId: new ObjectId() },
        { _id: cand2Id, userId: new ObjectId() },
      ])
    );

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      tally,
      CURRENT_TURN,
      NOW
    );

    expect(result.resolved).toBe(true);

    // Should delete all current officials for this house seat before inserting new ones
    expect(db.collectionMocks["electedOfficials"]!.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ officeType: "house", state: "CA-12" })
    );

    // Winners inserted (not upserted) for multi-seat
    expect(db.collectionMocks["electedOfficials"]!.insertOne).toHaveBeenCalled();

    // Post-election: leadership elections triggered
    const { triggerLeadershipElectionsAfterChamberVote } =
      await import("@/lib/congress/leadershipElections");
    expect(triggerLeadershipElectionsAfterChamberVote).toHaveBeenCalledWith(db, "house", NOW);

    // Next cycle spawned
    const { spawnHouseElection } = await import("@/lib/turn/election/electionSpawning");
    expect(spawnHouseElection).toHaveBeenCalledWith(db, election, NOW);
  });

  it("uses ordinary vote shares for a DDR chamber after democratic regime change", async () => {
    const election = makeElection({
      countryId: "DD",
      electionType: "volkskammerDeputy",
      state: "BEO",
      totalSeats: 100,
    });
    const minorityId = new ObjectId();
    const majorityId = new ObjectId();
    const tally = makeTally(election._id, {
      [minorityId.toString()]: 10_000,
      [majorityId.toString()]: 90_000,
    });
    const minority = makeCandidate(election._id, {
      characterId: minorityId,
      party: "1",
      characterName: "Former Ruling Candidate",
    });
    minority._id = minorityId;
    const majority = makeCandidate(election._id, {
      characterId: majorityId,
      party: "2",
      characterName: "Majority Candidate",
    });
    majority._id = majorityId;
    db.collectionMocks.electionCandidates!.find.mockReturnValue(makeCursor([minority, majority]));
    db.collectionMocks.characters!.find.mockReturnValue(
      makeCursor([
        { _id: minorityId, userId: new ObjectId() },
        { _id: majorityId, userId: new ObjectId() },
      ])
    );
    db.collection("countryState");
    db.collectionMocks.countryState!.findOne.mockResolvedValue({
      _id: "DD",
      governmentType: "parliamentaryRepublic",
      rulingPartyId: null,
      opsVoteMultipliers: null,
      hasLeaderConfidenceModel: false,
    });

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    const officials = db.collectionMocks.electedOfficials!.insertOne.mock.calls.map(
      (call) => call[0] as { party: string; seatsHeld: number }
    );
    expect(officials.find((official) => official.party === "1")?.seatsHeld).toBe(10);
    expect(officials.find((official) => official.party === "2")?.seatsHeld).toBe(90);
  });

  // ── President: delegates to resolvePresidentElection ────────────────────

  it("president election delegates to resolvePresidentElection and marks election resolved", async () => {
    const election = makeElection({ electionType: "president", state: "US" });
    const tally = makeTally(election._id, { [new ObjectId().toString()]: 1000 });

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      tally,
      CURRENT_TURN,
      NOW
    );

    const { resolvePresidentElection } = await import("@/lib/turn/election/presidentResolution");
    expect(resolvePresidentElection).toHaveBeenCalledWith(db, election, tally, NOW);
    expect(result.resolved).toBe(true);

    // Election marked resolved
    expect(db.collectionMocks["elections"]!.updateOne).toHaveBeenCalledWith(
      { _id: election._id },
      expect.objectContaining({ $set: expect.objectContaining({ status: "resolved" }) })
    );

    // Should NOT have written elected officials directly (president resolution handles that)
    expect(db.collectionMocks["electedOfficials"]!.updateOne).not.toHaveBeenCalled();
  });

  it("president election stays completed when resolvePresidentElection returns false", async () => {
    const election = makeElection({ electionType: "president", state: "US" });
    const tally = makeTally(election._id, { [new ObjectId().toString()]: 1000 });

    const { resolvePresidentElection } = await import("@/lib/turn/election/presidentResolution");
    vi.mocked(resolvePresidentElection).mockResolvedValueOnce(false);

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      tally,
      CURRENT_TURN,
      NOW
    );

    expect(result.resolved).toBe(false);
    const resolvedStatusUpdates = db.collectionMocks["elections"]!.updateOne.mock.calls.filter(
      ([, update]) => (update as { $set?: { status?: string } }).$set?.status === "resolved"
    );
    expect(resolvedStatusUpdates).toHaveLength(0);
  });

  // ── Commons sweep ─────────────────────────────────────────────────────────

  it("sweeps stale commons office for characters no longer in electedOfficials after resolve", async () => {
    const election = makeElection({
      electionType: "commons",
      state: "Bristol West",
      countryId: "UK",
    });

    const winnerId = new ObjectId();
    const candKey = winnerId.toString();
    const tally = makeTally(election._id, { [candKey]: 400 });

    const winner = makeCandidate(election._id, {
      characterId: winnerId,
      party: "LAB",
      characterName: "MP Winner",
    });
    winner._id = new ObjectId(candKey);

    const userId = new ObjectId();
    const winnerChar = { _id: winnerId, userId };

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([winner]));
    db.collectionMocks["characters"]!.find.mockReturnValue(makeCursor([winnerChar]));

    // sweepStaleOffice reads current electedOfficials — return the winner
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      makeCursor([
        { officeType: "commons", state: "Bristol West", characterId: winnerId, nppId: null },
      ])
    );

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      tally,
      CURRENT_TURN,
      NOW
    );

    expect(result.resolved).toBe(true);

    // characters.updateMany called to clear stale commons office claimants (sweep)
    const charUpdateManyCalls = db.collectionMocks["characters"]!.updateMany.mock.calls;
    const sweepCall = charUpdateManyCalls.find(
      (c) =>
        c[0]?.["currentOffice.type"] === "commons" &&
        c[0]?.["currentOffice.state"] === "Bristol West" &&
        c[1]?.$set?.currentOffice === null
    );
    expect(sweepCall).toBeDefined();

    // Next cycle spawned
    const { spawnCommonsElection } = await import("@/lib/turn/election/electionSpawning");
    expect(spawnCommonsElection).toHaveBeenCalledWith(db, election, NOW);
  });

  // ── Senate class scoping ─────────────────────────────────────────────────

  it("senate election includes senateClass in electedOfficials write", async () => {
    const election = makeElection({
      electionType: "senate",
      state: "PA",
      senateClass: 2,
    } as Partial<Election>);

    const charId = new ObjectId();
    const candKey = charId.toString();
    const tally = makeTally(election._id, { [candKey]: 1000 });

    const candidate = makeCandidate(election._id, {
      characterId: charId,
      party: "DEM",
      characterName: "Senator",
    });
    candidate._id = new ObjectId(candKey);

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([candidate]));
    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([{ _id: charId, userId: new ObjectId() }])
    );

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    const officialInsertCalls = db.collectionMocks["electedOfficials"]!.insertOne.mock.calls;
    const insertCall = officialInsertCalls.find(
      (c) => c[0]?.officeType === "senate" && c[0]?.state === "PA" && c[0]?.senateClass === 2
    );
    expect(insertCall).toBeDefined();
  });

  // ── Snap-election office normalization ───────────────────────────────────
  //
  // A snap_commons winner holds officeType "commons" (not "snap_commons") —
  // the snap designation lives on the ELECTION record, the resulting SEAT is
  // identical to a regular-cycle seat. These tests protect against regressions
  // where downstream officeType queries miss snap winners.

  it("snap_commons winner is written with officeType 'commons', not 'snap_commons'", async () => {
    const election = makeElection({
      electionType: "snap_commons",
      state: "Bristol West",
      countryId: "UK",
    });
    const winnerId = new ObjectId();
    const candKey = winnerId.toString();
    const tally = makeTally(election._id, { [candKey]: 400 });
    const winner = makeCandidate(election._id, {
      characterId: winnerId,
      party: "LAB",
      characterName: "Snap Winner",
    });
    winner._id = new ObjectId(candKey);

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([winner]));
    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([{ _id: winnerId, userId: new ObjectId() }])
    );
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(makeCursor([]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    // Multi-seat inserts the winner into electedOfficials via insertOne
    const inserts = db.collectionMocks["electedOfficials"]!.insertOne.mock.calls;
    const snapInsert = inserts.find((c) => c[0]?.state === "Bristol West");
    expect(snapInsert).toBeDefined();
    expect(snapInsert![0].officeType).toBe("commons"); // NOT "snap_commons"

    // Winner's character currentOffice set to type "commons"
    const charUpdates = db.collectionMocks["characters"]!.updateOne.mock.calls;
    const winnerUpdate = charUpdates.find(
      (c) => String(c[0]?._id) === String(winnerId) && c[1]?.$set?.currentOffice?.type === "commons"
    );
    expect(winnerUpdate).toBeDefined();
  });

  it("snap_commons deleteMany wipes 'commons' officials (not 'snap_commons')", async () => {
    const election = makeElection({
      electionType: "snap_commons",
      state: "Bristol West",
      countryId: "UK",
    });
    // null tally path so multiSeatOfficialFilter gets exercised for the sweep
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(makeCursor([]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, null, CURRENT_TURN, NOW);

    const deleteCalls = db.collectionMocks["electedOfficials"]!.deleteMany.mock.calls;
    const deleteWithCommons = deleteCalls.find(
      (c) => c[0]?.officeType === "commons" && c[0]?.state === "Bristol West"
    );
    expect(deleteWithCommons).toBeDefined();
    // Should NOT match on the raw snap type
    const deleteWithSnap = deleteCalls.find((c) => c[0]?.officeType === "snap_commons");
    expect(deleteWithSnap).toBeUndefined();
  });

  it("snap_shugiin winner is written with officeType 'shugiin', not 'snap_shugiin'", async () => {
    const election = makeElection({
      electionType: "snap_shugiin",
      state: "tokyo",
      countryId: "JP",
    });
    const winnerId = new ObjectId();
    const candKey = winnerId.toString();
    const tally = makeTally(election._id, { [candKey]: 500 });
    const winner = makeCandidate(election._id, {
      characterId: winnerId,
      party: "LDP",
      characterName: "Snap Winner",
    });
    winner._id = new ObjectId(candKey);

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([winner]));
    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([{ _id: winnerId, userId: new ObjectId() }])
    );
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(makeCursor([]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    const inserts = db.collectionMocks["electedOfficials"]!.insertOne.mock.calls;
    const snapInsert = inserts.find((c) => c[0]?.state === "tokyo");
    expect(snapInsert).toBeDefined();
    expect(snapInsert![0].officeType).toBe("shugiin"); // NOT "snap_shugiin"
  });

  // ── Defense-in-depth: never seat a hard-deleted character ───────────────────
  it("does not seat a candidate whose character was hard-deleted; the seat falls to the next eligible candidate", async () => {
    const election = makeElection({ electionType: "senate", state: "IL", senateClass: 3 });

    const deletedWinnerId = new ObjectId();
    const liveRunnerUpId = new ObjectId();
    const deletedKey = deletedWinnerId.toString();
    const liveKey = liveRunnerUpId.toString();

    // The deleted candidate out-polls the live one — but must NOT be seated.
    const tally = makeTally(election._id, { [deletedKey]: 2000, [liveKey]: 800 });

    const deletedWinner = makeCandidate(election._id, {
      characterId: deletedWinnerId,
      party: "3",
      characterName: "Ron Paul",
    });
    deletedWinner._id = new ObjectId(deletedKey);
    const liveRunnerUp = makeCandidate(election._id, {
      characterId: liveRunnerUpId,
      party: "1",
      characterName: "Live Challenger",
    });
    liveRunnerUp._id = new ObjectId(liveKey);

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(
      makeCursor([deletedWinner, liveRunnerUp])
    );
    // Only the live challenger's character document still exists.
    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([{ _id: liveRunnerUpId, userId: new ObjectId() }])
    );

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    const inserts = db.collectionMocks["electedOfficials"]!.insertOne.mock.calls;
    const seatInsert = inserts.find((c) => c[0]?.officeType === "senate");
    expect(seatInsert).toBeDefined();
    // The live runner-up takes the seat...
    expect(seatInsert![0].characterId?.toString()).toBe(liveRunnerUpId.toString());
    expect(seatInsert![0].characterName).toBe("Live Challenger");
    // ...and no elected-official row may reference the deleted character.
    const phantom = inserts.find(
      (c) => c[0]?.characterId?.toString() === deletedWinnerId.toString()
    );
    expect(phantom).toBeUndefined();
  });

  // ── Root cause: winning a seat must clear other live candidacies ─────────────
  it("withdraws the winner's still-active candidacies in other elections", async () => {
    const election = makeElection({ electionType: "senate", state: "IL", senateClass: 2 });
    const winnerId = new ObjectId();
    const winnerKey = winnerId.toString();
    const tally = makeTally(election._id, { [winnerKey]: 1500 });
    const winner = makeCandidate(election._id, {
      characterId: winnerId,
      party: "3",
      characterName: "Two-Seat Tom",
    });
    winner._id = new ObjectId(winnerKey);

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([winner]));
    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([{ _id: winnerId, userId: new ObjectId() }])
    );

    const { resolveOneGeneralElection } = await import("./generalResolution");
    await resolveOneGeneralElection(db as unknown as Db, election, tally, CURRENT_TURN, NOW);

    const updates = db.collectionMocks["electionCandidates"]!.updateMany.mock.calls;
    const otherRaceWithdraw = updates.find(
      (c) =>
        c[0]?.electionId?.$ne?.toString() === election._id.toString() &&
        c[0]?.status === "active" &&
        c[1]?.$set?.status === "withdrawn"
    );
    expect(otherRaceWithdraw).toBeDefined();
    // Scoped to the winner's identity.
    const orClause = otherRaceWithdraw![0].$or as Array<Record<string, unknown>>;
    expect(
      orClause.some(
        (o) => (o.characterId as { $in?: ObjectId[] })?.$in?.[0]?.toString() === winnerId.toString()
      )
    ).toBe(true);
  });
});
