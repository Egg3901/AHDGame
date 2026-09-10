/**
 * Unit tests for resolvePresidentElection — handles presidential election resolution.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/wiki/updatePoliticianPageOnElection", () => ({
  updatePoliticianPagesAfterElection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/cabinetTransition", () => ({
  clearCabinetOnTransition: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { electionResult: 0x00ff00 },
}));
vi.mock("@/lib/turn/electionCalculations", () => ({
  allocateElectoralVotes: vi.fn(),
  determinePresidentialWinner: vi.fn(),
}));
vi.mock("@/lib/turn/election/loadContingentElectionData", () => ({
  loadContingentElectionData: vi.fn(),
}));
vi.mock("@/lib/turn/election/contingentElection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./contingentElection")>();
  return {
    ...actual,
    resolveContingentElection: vi.fn(),
  };
});
vi.mock("@/lib/turn/history/recordCountryEvent", () => ({
  recordCountryEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db/collections", () => ({
  getGameStateCollection: vi.fn().mockResolvedValue({
    findOne: vi.fn().mockResolvedValue({ currentTurn: 100, preset: undefined }),
  }),
}));
vi.mock("@/lib/achievements", () => ({
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/achievements/triggers", () => ({
  checkElectionWinAchievements: vi.fn().mockResolvedValue(undefined),
  checkOfficeHeldAchievements: vi.fn().mockResolvedValue(undefined),
}));

const NOW = new Date("2025-06-15T12:00:00Z");

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("resolvePresidentElection", () => {
  let db: MockDb;
  const electionId = new ObjectId();
  const winnerId = new ObjectId();
  const loserId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of [
      "electionVoteTallies",
      "electionCandidates",
      "characters",
      "npps",
      "electedOfficials",
      "campaigns",
      "politicalParties",
    ]) {
      db.collection(name);
    }
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("handles missing totalVotesByUnit by finalizing and withdrawing", async () => {
    const election = { _id: electionId, electionType: "president" };
    const tally = { electionId, totalVotesByUnit: null };

    const { resolvePresidentElection } = await import("./presidentResolution");
    const result = await resolvePresidentElection(
      db as unknown as Db,
      election as never,
      tally as never,
      NOW
    );

    expect(result).toBe(true);
    expect(db.collectionMocks["electionVoteTallies"]!.updateOne).toHaveBeenCalled();
    expect(db.collectionMocks["electionCandidates"]!.updateMany).toHaveBeenCalled();
  });

  it("recovers totalVotesByUnit from unitTurnSnapshots when running totals are empty", async () => {
    const election = { _id: electionId, electionType: "president" };
    // Running totals lost (concurrent write / partial wipe), but unitTurnSnapshots
    // still has the last cumulative votes per unit — resolution should recover
    // rather than vacate.
    const tally = {
      electionId,
      totalVotesByUnit: null,
      candidateNames: {
        [winnerId.toString()]: "Winner",
        [loserId.toString()]: "Loser",
      },
      unitTurnSnapshots: {
        CA: [
          {
            turn: 95,
            recordedAt: NOW,
            cumulativeVotes: { [winnerId.toString()]: 800, [loserId.toString()]: 600 },
            sharesPct: {},
          },
        ],
        TX: [
          {
            turn: 95,
            recordedAt: NOW,
            cumulativeVotes: { [winnerId.toString()]: 400, [loserId.toString()]: 700 },
            sharesPct: {},
          },
        ],
      },
    };

    const { allocateElectoralVotes, determinePresidentialWinner } =
      await import("@/lib/turn/electionCalculations");
    vi.mocked(allocateElectoralVotes).mockReturnValue({
      [winnerId.toString()]: 300,
      [loserId.toString()]: 238,
    });
    vi.mocked(determinePresidentialWinner).mockReturnValue({
      winnerId: winnerId.toString(),
      winnerEV: 300,
    });

    const winnerCandidate = {
      _id: winnerId,
      electionId,
      characterId: new ObjectId(),
      characterName: "Winner",
      party: "DEM",
      isNPP: false,
      runningMateId: null,
    };
    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([winnerCandidate]));
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: winnerCandidate.characterId,
      userId: new ObjectId(),
      name: "Winner",
    });
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([]));

    const { resolvePresidentElection } = await import("./presidentResolution");
    const result = await resolvePresidentElection(
      db as unknown as Db,
      election as never,
      tally as never,
      NOW
    );

    expect(result).toBe(true);
    // allocateElectoralVotes should receive the recovered map keyed by unit,
    // not null/empty — proving the recovery path fed it real data.
    const allocateArg = vi.mocked(allocateElectoralVotes).mock.calls[0][0];
    expect(allocateArg).toMatchObject({
      CA: { [winnerId.toString()]: 800, [loserId.toString()]: 600 },
      TX: { [winnerId.toString()]: 400, [loserId.toString()]: 700 },
    });
  });

  it("recovery filters out withdrawn candidates absent from tally.candidateNames", async () => {
    const election = { _id: electionId, electionType: "president" };
    const withdrawnId = new ObjectId();
    // Snapshot carries votes for a candidate that has since withdrawn —
    // `removeWithdrawnCandidateFromTally` $unset their entry from
    // `candidateNames`. The recovery must not resurrect them.
    const tally = {
      electionId,
      totalVotesByUnit: null,
      candidateNames: { [winnerId.toString()]: "Winner" },
      unitTurnSnapshots: {
        CA: [
          {
            turn: 95,
            recordedAt: NOW,
            cumulativeVotes: {
              [winnerId.toString()]: 800,
              [withdrawnId.toString()]: 1500,
            },
            sharesPct: {},
          },
        ],
      },
    };

    const { allocateElectoralVotes, determinePresidentialWinner } =
      await import("@/lib/turn/electionCalculations");
    vi.mocked(allocateElectoralVotes).mockReturnValue({
      [winnerId.toString()]: 538,
    });
    vi.mocked(determinePresidentialWinner).mockReturnValue({
      winnerId: winnerId.toString(),
      winnerEV: 538,
    });

    const winnerCandidate = {
      _id: winnerId,
      electionId,
      characterId: new ObjectId(),
      characterName: "Winner",
      party: "DEM",
      isNPP: false,
      runningMateId: null,
    };
    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([winnerCandidate]));
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: winnerCandidate.characterId,
      userId: new ObjectId(),
      name: "Winner",
    });
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([]));

    const { resolvePresidentElection } = await import("./presidentResolution");
    await resolvePresidentElection(db as unknown as Db, election as never, tally as never, NOW);

    // Withdrawn candidate's snapshot votes must not appear in the recovered
    // map handed to allocateElectoralVotes.
    const allocateArg = vi.mocked(allocateElectoralVotes).mock.calls[0][0];
    expect(allocateArg.CA).toEqual({ [winnerId.toString()]: 800 });
    expect(allocateArg.CA[withdrawnId.toString()]).toBeUndefined();
  });

  it("handles zero total electoral votes by finalizing", async () => {
    const election = { _id: electionId, electionType: "president" };
    const tally = { electionId, totalVotesByUnit: { CA: {} } };

    const { allocateElectoralVotes } = await import("@/lib/turn/electionCalculations");
    vi.mocked(allocateElectoralVotes).mockReturnValue({});

    const { resolvePresidentElection } = await import("./presidentResolution");
    const result = await resolvePresidentElection(
      db as unknown as Db,
      election as never,
      tally as never,
      NOW
    );

    expect(result).toBe(true);
  });

  it("resolves election with clear winner", async () => {
    const election = { _id: electionId, electionType: "president" };
    const tally = {
      electionId,
      totalVotesByUnit: { CA: { [winnerId.toString()]: 1000, [loserId.toString()]: 500 } },
    };

    const { allocateElectoralVotes, determinePresidentialWinner } =
      await import("@/lib/turn/electionCalculations");
    vi.mocked(allocateElectoralVotes).mockReturnValue({
      [winnerId.toString()]: 300,
      [loserId.toString()]: 238,
    });
    vi.mocked(determinePresidentialWinner).mockReturnValue({
      winnerId: winnerId.toString(),
      winnerEV: 300,
    });

    // Set up candidate documents
    const winnerCandidate = {
      _id: winnerId,
      electionId,
      characterId: new ObjectId(),
      characterName: "Winner",
      party: "DEM",
      isNPP: false,
      runningMateId: null,
    };
    const loserCandidate = {
      _id: loserId,
      electionId,
      characterId: new ObjectId(),
      characterName: "Loser",
      party: "GOP",
      isNPP: false,
    };

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(
      makeCursor([winnerCandidate, loserCandidate])
    );
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: winnerCandidate.characterId,
      userId: new ObjectId(),
      name: "Winner",
    });
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([]));

    const { resolvePresidentElection } = await import("./presidentResolution");
    const result = await resolvePresidentElection(
      db as unknown as Db,
      election as never,
      tally as never,
      NOW
    );

    expect(result).toBe(true);

    // Cabinet should be cleared
    const { clearCabinetOnTransition } = await import("@/lib/cabinetTransition");
    expect(clearCabinetOnTransition).toHaveBeenCalledWith(expect.anything(), "US");

    // President should be set in electedOfficials
    const upsertCalls = db.collectionMocks["electedOfficials"]!.updateOne.mock.calls;
    const presidentUpsert = upsertCalls.find(
      (c: unknown[]) =>
        (c[0] as Record<string, unknown>).officeType === "president" &&
        (c[2] as Record<string, unknown>)?.upsert === true
    );
    expect(presidentUpsert).toBeDefined();

    // Tally should be finalized
    expect(db.collectionMocks["electionVoteTallies"]!.updateOne).toHaveBeenCalled();

    // All active candidates should be withdrawn, including zero-EV candidates
    // that are absent from electoralVotesByCandidate.
    expect(db.collectionMocks["electionCandidates"]!.updateMany).toHaveBeenCalledWith(
      { electionId: election._id, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: NOW } }
    );

    // Campaigns should be cleaned up
    expect(db.collectionMocks["campaigns"]!.deleteMany).toHaveBeenCalledWith({
      electionId: election._id,
    });
  });

  it("partial-25% resets all characterStateOrg levels on resolve", async () => {
    const election = { _id: electionId, electionType: "president" };
    const tally = {
      electionId,
      totalVotesByUnit: { CA: { [winnerId.toString()]: 1000, [loserId.toString()]: 500 } },
    };

    const { allocateElectoralVotes, determinePresidentialWinner } =
      await import("@/lib/turn/electionCalculations");
    vi.mocked(allocateElectoralVotes).mockReturnValue({ [winnerId.toString()]: 538 });
    vi.mocked(determinePresidentialWinner).mockReturnValue({
      winnerId: winnerId.toString(),
      winnerEV: 538,
    });

    const winnerCandidate = {
      _id: winnerId,
      electionId,
      characterId: new ObjectId(),
      characterName: "Winner",
      party: "DEM",
      isNPP: false,
      runningMateId: null,
    };
    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([winnerCandidate]));
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: winnerCandidate.characterId,
      userId: new ObjectId(),
      name: "Winner",
    });
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([]));

    // The partial-25% reset is a single pipeline updateMany over level > 0
    // rows, with half-up rounding (floor(level * 0.25 + 0.5)) to match the
    // previous Math.round behavior.
    db.collection("characterStateOrg");
    db.collectionMocks["characterStateOrg"]!.updateMany.mockResolvedValue({ modifiedCount: 2 });

    const { resolvePresidentElection } = await import("./presidentResolution");
    const result = await resolvePresidentElection(
      db as unknown as Db,
      election as never,
      tally as never,
      NOW
    );
    expect(result).toBe(true);

    const orgUpdateCalls = db.collectionMocks["characterStateOrg"]!.updateMany.mock.calls;
    expect(orgUpdateCalls).toHaveLength(1);
    const [filter, pipeline] = orgUpdateCalls[0] as [
      Record<string, unknown>,
      Array<{ $set: Record<string, unknown> }>,
    ];
    expect(filter).toEqual({ level: { $gt: 0 } });
    expect(Array.isArray(pipeline)).toBe(true);
    expect(pipeline[0].$set.level).toEqual({
      $floor: { $add: [{ $multiply: ["$level", 0.25] }, 0.5] },
    });
    // totalInvested must not be in the $set — it's a career running tally
    // that is intentionally preserved across the reset.
    expect(pipeline[0].$set.totalInvested).toBeUndefined();
  });

  it("returns false when winner candidate document is missing", async () => {
    const election = { _id: electionId, electionType: "president" };
    const tally = {
      electionId,
      totalVotesByUnit: { CA: { [winnerId.toString()]: 1000 } },
    };

    const { allocateElectoralVotes, determinePresidentialWinner } =
      await import("@/lib/turn/electionCalculations");
    vi.mocked(allocateElectoralVotes).mockReturnValue({
      [winnerId.toString()]: 300,
    });
    vi.mocked(determinePresidentialWinner).mockReturnValue({
      winnerId: winnerId.toString(),
      winnerEV: 300,
    });

    // No candidates found
    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([]));

    const { resolvePresidentElection } = await import("./presidentResolution");
    const result = await resolvePresidentElection(
      db as unknown as Db,
      election as never,
      tally as never,
      NOW
    );

    // Should return false (retry next turn)
    expect(result).toBe(false);
  });

  it("auto-selects highest-PI same-party NPP as VP when NPP wins with no running mate", async () => {
    const nppWinnerId = new ObjectId();
    const nppWinnerNppId = new ObjectId();
    const vpNppId = new ObjectId();
    const election = { _id: electionId, electionType: "president", countryId: "US" };
    const tally = {
      electionId,
      totalVotesByUnit: { CA: { [nppWinnerId.toString()]: 1000 } },
    };

    const { allocateElectoralVotes, determinePresidentialWinner } =
      await import("@/lib/turn/electionCalculations");
    vi.mocked(allocateElectoralVotes).mockReturnValue({
      [nppWinnerId.toString()]: 300,
    });
    vi.mocked(determinePresidentialWinner).mockReturnValue({
      winnerId: nppWinnerId.toString(),
      winnerEV: 300,
    });

    const nppWinnerCandidate = {
      _id: nppWinnerId,
      electionId,
      characterId: null,
      characterName: "NPP President",
      party: "REP",
      isNPP: true,
      nppId: nppWinnerNppId,
      runningMateId: undefined,
    };

    const vpNpp = {
      _id: vpNppId,
      name: "NPP VP",
      party: "REP",
      countryId: "US",
      politicalInfluence: 75,
      currentOffice: null,
    };

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(
      makeCursor([nppWinnerCandidate])
    );
    // First npps.find call: auto-select VP candidate
    // Second npps.findOne call: fetch VP NPP details (called inside the vpNppId block)
    db.collectionMocks["npps"]!.find.mockReturnValue(makeCursor([vpNpp]));
    db.collectionMocks["npps"]!.findOne.mockResolvedValue(vpNpp);
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([]));

    const { resolvePresidentElection } = await import("./presidentResolution");
    const result = await resolvePresidentElection(
      db as unknown as Db,
      election as never,
      tally as never,
      NOW
    );

    expect(result).toBe(true);

    // Should have queried for same-party NPPs sorted by politicalInfluence
    expect(db.collectionMocks["npps"]!.find).toHaveBeenCalledWith(
      expect.objectContaining({
        party: "REP",
        countryId: "US",
        _id: { $ne: nppWinnerNppId },
      }),
      { projection: { _id: 1 } }
    );

    // VP should be set in electedOfficials with isNPP: true and nppId
    const upsertCalls = db.collectionMocks["electedOfficials"]!.updateOne.mock.calls;
    const vpUpsert = upsertCalls.find(
      (c: unknown[]) =>
        (c[0] as Record<string, unknown>).officeType === "vicePresident" &&
        (c[2] as Record<string, unknown>)?.upsert === true
    );
    expect(vpUpsert).toBeDefined();
    const vpSetData = (vpUpsert![1] as Record<string, Record<string, unknown>>).$set;
    expect(vpSetData.isNPP).toBe(true);
    expect(vpSetData.nppId).toEqual(vpNppId);

    // VP NPP's currentOffice should be updated
    const nppUpdateCalls = db.collectionMocks["npps"]!.updateOne.mock.calls;
    const vpNppUpdate = nppUpdateCalls.find((c: unknown[]) => {
      const setDoc = (c[1] as Record<string, Record<string, Record<string, unknown>>>).$set;
      return setDoc?.currentOffice?.type === "vicePresident";
    });
    expect(vpNppUpdate).toBeDefined();
  });

  it("sets VP when running mate exists", async () => {
    const vpCharId = new ObjectId();
    const election = { _id: electionId, electionType: "president" };
    const tally = {
      electionId,
      totalVotesByUnit: { CA: { [winnerId.toString()]: 1000 } },
    };

    const { allocateElectoralVotes, determinePresidentialWinner } =
      await import("@/lib/turn/electionCalculations");
    vi.mocked(allocateElectoralVotes).mockReturnValue({
      [winnerId.toString()]: 300,
    });
    vi.mocked(determinePresidentialWinner).mockReturnValue({
      winnerId: winnerId.toString(),
      winnerEV: 300,
    });

    const winnerCandidate = {
      _id: winnerId,
      electionId,
      characterId: new ObjectId(),
      characterName: "President",
      party: "DEM",
      isNPP: false,
      runningMateId: vpCharId,
    };

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([winnerCandidate]));
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: vpCharId,
      userId: new ObjectId(),
      name: "VP",
      party: "DEM",
    });
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([]));

    const { resolveUserIdFromCharacter } = await import("@/lib/achievements");
    vi.mocked(resolveUserIdFromCharacter).mockResolvedValue(new ObjectId());

    const { resolvePresidentElection } = await import("./presidentResolution");
    const result = await resolvePresidentElection(
      db as unknown as Db,
      election as never,
      tally as never,
      NOW
    );

    expect(result).toBe(true);

    // VP should be set
    const upsertCalls = db.collectionMocks["electedOfficials"]!.updateOne.mock.calls;
    const vpUpsert = upsertCalls.find(
      (c: unknown[]) =>
        (c[0] as Record<string, unknown>).officeType === "vicePresident" &&
        (c[2] as Record<string, unknown>)?.upsert === true
    );
    expect(vpUpsert).toBeDefined();

    const { checkOfficeHeldAchievements } = await import("@/lib/achievements/triggers");
    expect(checkOfficeHeldAchievements).toHaveBeenCalledWith(
      expect.anything(),
      vpCharId,
      "vicePresident"
    );
  });

  it("does not clear the cabinet when the sitting president wins re-election", async () => {
    const incumbentCharId = new ObjectId();
    const election = { _id: electionId, electionType: "president", countryId: "US" };
    const tally = {
      electionId,
      totalVotesByUnit: { CA: { [winnerId.toString()]: 1000 } },
    };

    const { allocateElectoralVotes, determinePresidentialWinner } =
      await import("@/lib/turn/electionCalculations");
    vi.mocked(allocateElectoralVotes).mockReturnValue({
      [winnerId.toString()]: 300,
    });
    vi.mocked(determinePresidentialWinner).mockReturnValue({
      winnerId: winnerId.toString(),
      winnerEV: 300,
    });

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: winnerId,
          electionId,
          characterId: incumbentCharId,
          characterName: "Incumbent",
          party: "DEM",
          isNPP: false,
          runningMateId: null,
        },
      ])
    );
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
      officeType: "president",
      characterId: incumbentCharId,
    });
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: incumbentCharId,
      userId: new ObjectId(),
      careerHistory: [
        {
          type: "elected",
          office: { type: "president" },
          officeLabel: "President",
          date: new Date("2021-01-20T12:00:00Z"),
        },
      ],
      executiveTermsServed: { US: 1 },
    });
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([]));

    const { resolvePresidentElection } = await import("./presidentResolution");
    const result = await resolvePresidentElection(
      db as unknown as Db,
      election as never,
      tally as never,
      NOW
    );

    expect(result).toBe(true);
    const { clearCabinetOnTransition } = await import("@/lib/cabinetTransition");
    expect(clearCabinetOnTransition).not.toHaveBeenCalled();
  });

  it("resolves a 269-269 tie through the House contingent ballot", async () => {
    const election = { _id: electionId, electionType: "president", countryId: "US" };
    const tally = {
      electionId,
      totalVotesByUnit: {
        ST1: { [winnerId.toString()]: 500, [loserId.toString()]: 400 },
      },
    };

    const { allocateElectoralVotes, determinePresidentialWinner } =
      await import("@/lib/turn/electionCalculations");
    const { loadContingentElectionData } = await import("./loadContingentElectionData");
    const { resolveContingentElection } = await import("./contingentElection");

    vi.mocked(allocateElectoralVotes).mockReturnValue({
      [winnerId.toString()]: 269,
      [loserId.toString()]: 269,
    });
    vi.mocked(determinePresidentialWinner).mockReturnValue(null);
    vi.mocked(loadContingentElectionData).mockResolvedValue({
      presidentCandidates: [],
      vicePresidentCandidates: [],
      houseDelegations: [],
      senators: [],
    });
    vi.mocked(resolveContingentElection).mockReturnValue({
      resolutionMode: "contingent",
      eligiblePresidentCandidateIds: [winnerId.toString(), loserId.toString()],
      eligibleVicePresidentCandidateIds: [],
      houseDelegationVotes: { TX: winnerId.toString() },
      houseVoteTotals: { [winnerId.toString()]: 26, [loserId.toString()]: 24 },
      senateVotes: {},
      senateVoteTotals: {},
      presidentWinnerId: winnerId.toString(),
      vicePresidentWinnerId: null,
      houseThreshold: 26,
      senateThreshold: 51,
      deadlockBreakerUsed: false,
      topElectoralVoteTotal: 269,
    });

    const winnerCandidate = {
      _id: winnerId,
      electionId,
      characterId: new ObjectId(),
      characterName: "House Pick",
      party: "DEM",
      isNPP: false,
      runningMateId: null,
    };
    const loserCandidate = {
      _id: loserId,
      electionId,
      characterId: new ObjectId(),
      characterName: "EV Leader",
      party: "GOP",
      isNPP: false,
    };

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(
      makeCursor([winnerCandidate, loserCandidate])
    );
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: winnerCandidate.characterId,
      userId: new ObjectId(),
      name: "House Pick",
      careerHistory: [],
      executiveTermsServed: {},
    });
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([]));

    const { resolvePresidentElection } = await import("./presidentResolution");
    const result = await resolvePresidentElection(
      db as unknown as Db,
      election as never,
      tally as never,
      NOW
    );

    expect(result).toBe(true);
    expect(resolveContingentElection).toHaveBeenCalled();
    expect(db.collectionMocks["electionVoteTallies"]!.updateOne).toHaveBeenCalledWith(
      { electionId: election._id, finalized: { $ne: true } },
      expect.objectContaining({
        $set: expect.objectContaining({
          resolutionMode: "contingent",
          contingentResult: expect.objectContaining({
            presidentWinnerId: winnerId.toString(),
          }),
        }),
      })
    );
  });

  it("heals legacy executive rows by writing countryId onto the president and vice president records", async () => {
    const election = { _id: electionId, electionType: "president", countryId: "US" };
    const tally = {
      electionId,
      totalVotesByUnit: { CA: { [winnerId.toString()]: 1000 } },
    };

    const { allocateElectoralVotes, determinePresidentialWinner } =
      await import("@/lib/turn/electionCalculations");
    vi.mocked(allocateElectoralVotes).mockReturnValue({
      [winnerId.toString()]: 300,
    });
    vi.mocked(determinePresidentialWinner).mockReturnValue({
      winnerId: winnerId.toString(),
      winnerEV: 300,
    });

    const vpCharId = new ObjectId();
    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: winnerId,
          electionId,
          characterId: new ObjectId(),
          characterName: "Winner",
          party: "DEM",
          isNPP: false,
          runningMateId: vpCharId,
        },
      ])
    );
    db.collectionMocks["characters"]!.findOne.mockResolvedValueOnce({
      _id: new ObjectId(),
      userId: new ObjectId(),
      careerHistory: [],
      executiveTermsServed: {},
    }).mockResolvedValueOnce({
      _id: vpCharId,
      userId: new ObjectId(),
      name: "VP",
      party: "DEM",
    });
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([]));

    const { resolvePresidentElection } = await import("./presidentResolution");
    const result = await resolvePresidentElection(
      db as unknown as Db,
      election as never,
      tally as never,
      NOW
    );

    expect(result).toBe(true);
    expect(db.collectionMocks["electedOfficials"]!.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        officeType: "president",
        $or: [{ countryId: "US" }, { countryId: { $exists: false } }],
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ countryId: "US" }),
      }),
      { upsert: true }
    );
    expect(db.collectionMocks["electedOfficials"]!.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        officeType: "vicePresident",
        $or: [{ countryId: "US" }, { countryId: { $exists: false } }],
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ countryId: "US" }),
      }),
      { upsert: true }
    );
  });
});
