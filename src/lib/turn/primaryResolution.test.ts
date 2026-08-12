/**
 * Unit tests for primaryResolution: resolvePrimariesIfNeeded, recordPrimarySnapshots,
 * and accumulateGeneralElectionVotes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn(),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(new ObjectId()),
}));
vi.mock("@/lib/electionEngine", () => ({
  fetchEnrichedCandidates: vi.fn(),
  initElectionVoteTally: vi.fn(),
  accumulateVoteTurn: vi.fn(),
}));
vi.mock("@/lib/presidentialElectionEngine", () => ({
  initPresidentVoteTally: vi.fn(),
  accumulatePresidentVoteTurn: vi.fn(),
}));
vi.mock("@/lib/primaryScore", () => ({
  calcPrimaryScore: vi.fn(),
  calcPresidentPrimaryScore: vi.fn(),
  // Deterministic even split keeps snapshot-shape assertions stable regardless
  // of the (mocked) raw scores; the softmax curve itself is unit-tested directly.
  primarySharePctSoftmax: (scores: number[]) =>
    scores.map(() => (scores.length ? Math.round(10000 / scores.length) / 100 : 0)),
  // Chair-map helpers used by the presidential primary path (#3004/#3019). The
  // chair boost is inert, so effective party influence is a passthrough.
  buildPartyChairMaps: () => ({
    nationalChairIds: new Set<string>(),
    stateChairStatesByCharacterId: new Map<string, string[]>(),
  }),
  resolvePartyChairPrimaryRole: () => null,
  effectivePartyInfluenceForPresidentialPrimary: (v: number) => Math.max(0, v),
}));
vi.mock("@/lib/utils/getStateApprovalForElection", () => ({
  getAllStateApprovalsForElection: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/utils/electionLabels", () => ({
  formatElectionTypeLabel: vi.fn().mockReturnValue("Senate"),
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

describe("resolvePrimariesIfNeeded", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("does nothing when no elections have passed primaryEndTime", async () => {
    // Pre-init collections we want to assert on
    db.collection("electionCandidates");
    const { resolvePrimariesIfNeeded } = await import("./primaryResolution");
    await resolvePrimariesIfNeeded(NOW, 100);

    expect(db.collectionMocks["electionCandidates"]!.updateMany).not.toHaveBeenCalled();
  });

  it("records primaryResults for uncontested parties without eliminating anyone", async () => {
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      electionType: "senate",
      status: "active",
      countryId: "US",
      state: "CA",
      primaryEndTime: new Date(NOW.getTime() - 1000),
      endTime: new Date(NOW.getTime() + 100000),
    };

    const candidate1 = {
      _id: new ObjectId(),
      electionId,
      party: "DEM",
      characterName: "Alice",
      characterId: new ObjectId(),
      isNPP: false,
      status: "active",
    };
    const candidate2 = {
      _id: new ObjectId(),
      electionId,
      party: "GOP",
      characterName: "Bob",
      characterId: new ObjectId(),
      isNPP: false,
      status: "active",
    };

    // elections.find returns our election
    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));

    // parties
    db.collectionMocks["politicalParties"] = db.collection("politicalParties");
    db.collectionMocks["politicalParties"].find.mockReturnValue(makeCursor([]));

    // candidates — one per party
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    db.collectionMocks["electionCandidates"].find.mockReturnValue(
      makeCursor([candidate1, candidate2])
    );

    const { fetchEnrichedCandidates } = await import("@/lib/electionEngine");
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue(
      [candidate1, candidate2].map((c) => ({
        candidateId: c._id.toString(),
        charEP: 0,
        charSP: 0,
        favorability: 50,
        politicalInfluence: 100,
      })) as never
    );
    const { calcPrimaryScore } = await import("@/lib/primaryScore");
    vi.mocked(calcPrimaryScore).mockReturnValue(50);

    db.collectionMocks["characters"] = db.collection("characters");
    db.collectionMocks["characters"].find.mockReturnValue(
      makeCursor(
        [candidate1, candidate2].map((c) => ({ _id: c.characterId, userId: new ObjectId() }))
      )
    );
    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    db.collectionMocks["electionVoteTallies"].find.mockReturnValue(makeCursor([]));

    const { resolvePrimariesIfNeeded } = await import("./primaryResolution");
    await resolvePrimariesIfNeeded(NOW, 100);

    // No withdrawals — each party already at/under the advance cap
    expect(db.collectionMocks["electionCandidates"].updateMany).not.toHaveBeenCalled();
    // But still stamp primaryResults so districted house (and similar) can split
    // seats by primary share rather than falling back to general-vote share.
    const { initElectionVoteTally } = await import("@/lib/electionEngine");
    expect(initElectionVoteTally).toHaveBeenCalled();
    const primaryResults = vi.mocked(initElectionVoteTally).mock.calls[0][3];
    expect(primaryResults?.byParty?.DEM?.[0]?.won).toBe(true);
    expect(primaryResults?.byParty?.GOP?.[0]?.won).toBe(true);
  });

  it("eliminates lowest-scoring candidates in a contested primary", async () => {
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      electionType: "senate",
      status: "active",
      countryId: "US",
      state: "CA",
      primaryEndTime: new Date(NOW.getTime() - 1000),
      endTime: new Date(NOW.getTime() + 100000),
    };

    const winnerId = new ObjectId();
    const loserId = new ObjectId();
    const candidates = [
      {
        _id: winnerId,
        electionId,
        party: "DEM",
        characterName: "Winner",
        characterId: new ObjectId(),
        isNPP: false,
        status: "active",
      },
      {
        _id: loserId,
        electionId,
        party: "DEM",
        characterName: "Loser",
        characterId: new ObjectId(),
        isNPP: false,
        status: "active",
      },
    ];

    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));
    db.collectionMocks["politicalParties"] = db.collection("politicalParties");
    db.collectionMocks["politicalParties"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");

    // First call: all active candidates for election; second call: post-primary active candidates.
    // An `_id.$in` lookup (the loser-cleanup fetch) is answered by matching the
    // requested ids so the archive step sees the real loser doc.
    let candidateFindCall = 0;
    db.collectionMocks["electionCandidates"].find.mockImplementation((query?: unknown) => {
      const idFilter = (query as { _id?: { $in?: ObjectId[] } })?._id?.$in;
      if (idFilter) {
        const ids = idFilter.map((id) => id.toString());
        return makeCursor(candidates.filter((c) => ids.includes(c._id.toString())));
      }
      candidateFindCall++;
      if (candidateFindCall === 1) return makeCursor(candidates);
      // After elimination, only winner remains
      return makeCursor([candidates[0]]);
    });

    // fetchEnrichedCandidates returns enriched data
    const { fetchEnrichedCandidates } = await import("@/lib/electionEngine");
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue(
      candidates.map((c) => ({
        candidateId: c._id.toString(),
        charEP: 0,
        charSP: 0,
        favorability: 50,
        politicalInfluence: 100,
      })) as never
    );

    // calcPrimaryScore returns different scores so winner > loser
    const { calcPrimaryScore } = await import("@/lib/primaryScore");
    vi.mocked(calcPrimaryScore)
      .mockReturnValueOnce(80) // Winner
      .mockReturnValueOnce(40); // Loser

    // Characters for notifications
    db.collectionMocks["characters"] = db.collection("characters");
    db.collectionMocks["characters"].find.mockReturnValue(
      makeCursor(
        candidates.map((c) => ({
          _id: c.characterId,
          userId: new ObjectId(),
        }))
      )
    );

    // No existing tally
    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    db.collectionMocks["electionVoteTallies"].findOne.mockResolvedValue(null);

    const { resolvePrimariesIfNeeded } = await import("./primaryResolution");
    await resolvePrimariesIfNeeded(NOW, 100);

    // Should withdraw the loser
    expect(db.collectionMocks["electionCandidates"].updateMany).toHaveBeenCalled();
    const withdrawCall = db.collectionMocks["electionCandidates"].updateMany.mock.calls[0];
    const withdrawnIds = withdrawCall[0]._id.$in.map((id: ObjectId) => id.toString());
    expect(withdrawnIds).toContain(loserId.toString());
    expect(withdrawnIds).not.toContain(winnerId.toString());

    // Loser's campaign should be ARCHIVED (soft), never hard-deleted — so a
    // re-entry or a backup gap can't strand the candidate without a campaign.
    expect(db.collectionMocks["campaigns"]?.deleteMany).not.toHaveBeenCalled();
    const archiveCall = db.collectionMocks["campaigns"]!.updateMany.mock.calls.find(
      (c: unknown[]) => (c[1] as { $set?: { status?: string } })?.$set?.status === "archived"
    );
    expect(archiveCall).toBeDefined();
    const archivedCandidateIds = (
      archiveCall![0] as { candidateId: { $in: ObjectId[] } }
    ).candidateId.$in.map((id) => id.toString());
    expect(archivedCandidateIds).toContain(candidates[1].characterId.toString());

    // Should initialize vote tally for general election
    const { initElectionVoteTally } = await import("@/lib/electionEngine");
    expect(initElectionVoteTally).toHaveBeenCalled();

    // Ticket #826 item 11: eliminating a primary loser must void any debate
    // session still pending for this election, rather than leaving it live
    // for up to its own 12h real-time deadline.
    const debateVoidCall = db.collectionMocks["debateSessions"]?.updateMany.mock.calls.find(
      (c: unknown[]) => (c[1] as { $set?: { status?: string } })?.$set?.status === "expired"
    );
    expect(debateVoidCall).toBeDefined();
    expect(debateVoidCall![0]).toMatchObject({ electionId, status: "awaitingStrategies" });
    expect((debateVoidCall![1] as { $set: { resolveReason?: string } }).$set.resolveReason).toBe(
      "election_ended"
    );
  });

  it("applies 0.75x NPP penalty when player is in same party", async () => {
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      electionType: "senate",
      status: "active",
      countryId: "US",
      state: "CA",
      primaryEndTime: new Date(NOW.getTime() - 1000),
      endTime: new Date(NOW.getTime() + 100000),
    };

    const playerCandidate = {
      _id: new ObjectId(),
      electionId,
      party: "DEM",
      characterName: "Player",
      characterId: new ObjectId(),
      isNPP: false,
      status: "active",
    };
    const nppCandidate = {
      _id: new ObjectId(),
      electionId,
      party: "DEM",
      characterName: "NPC",
      characterId: new ObjectId(),
      nppId: new ObjectId(),
      isNPP: true,
      status: "active",
    };

    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));
    db.collectionMocks["politicalParties"] = db.collection("politicalParties");
    db.collectionMocks["politicalParties"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    let candidateFindCall = 0;
    db.collectionMocks["electionCandidates"].find.mockImplementation(() => {
      candidateFindCall++;
      if (candidateFindCall === 1) return makeCursor([playerCandidate, nppCandidate]);
      return makeCursor([playerCandidate]);
    });

    const { fetchEnrichedCandidates } = await import("@/lib/electionEngine");
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue(
      [playerCandidate, nppCandidate].map((c) => ({
        candidateId: c._id.toString(),
        charEP: 0,
        charSP: 0,
        favorability: 50,
        politicalInfluence: 100,
      })) as never
    );

    // Both get same base score of 60 — but NPP gets 0.75x = 45
    const { calcPrimaryScore } = await import("@/lib/primaryScore");
    vi.mocked(calcPrimaryScore).mockReturnValue(60);

    db.collectionMocks["characters"] = db.collection("characters");
    db.collectionMocks["characters"].find.mockReturnValue(
      makeCursor([{ _id: playerCandidate.characterId, userId: new ObjectId() }])
    );
    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    db.collectionMocks["electionVoteTallies"].findOne.mockResolvedValue(null);

    const { resolvePrimariesIfNeeded } = await import("./primaryResolution");
    await resolvePrimariesIfNeeded(NOW, 100);

    // NPP should be eliminated (60*0.75=45 < 60)
    expect(db.collectionMocks["electionCandidates"].updateMany).toHaveBeenCalled();
    const withdrawCall = db.collectionMocks["electionCandidates"].updateMany.mock.calls[0];
    const withdrawnIds = withdrawCall[0]._id.$in.map((id: ObjectId) => id.toString());
    expect(withdrawnIds).toContain(nppCandidate._id.toString());
    expect(withdrawnIds).not.toContain(playerCandidate._id.toString());
  });

  // Regression: for countries where the primary-winners cap > 1 (parliamentary
  // → 3, onePartyState → 7), after the primary resolves each party still has
  // up to maxAdvancing active candidates AND the tally already carries
  // primaryResults. The gate must skip these on subsequent turns, otherwise the
  // general-phase vote tally is wiped via initElectionVoteTally every turn.
  it("does not reinitialize tally when UK parties already have only maxAdvancing candidates", async () => {
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      electionType: "commons",
      status: "active",
      countryId: "UK",
      state: "SWE",
      primaryEndTime: new Date(NOW.getTime() - 3600_000),
      endTime: new Date(NOW.getTime() + 3600_000),
    };

    // Post-primary state: a single party with 3 active candidates (UK advances 3).
    const candidates = [1, 2, 3].map((i) => ({
      _id: new ObjectId(),
      electionId,
      party: "uk_labour",
      characterName: `Cand${i}`,
      characterId: new ObjectId(),
      isNPP: false,
      status: "active",
    }));

    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));
    db.collectionMocks["politicalParties"] = db.collection("politicalParties");
    db.collectionMocks["politicalParties"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    db.collectionMocks["electionCandidates"].find.mockReturnValue(makeCursor(candidates));
    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    db.collectionMocks["electionVoteTallies"].find.mockReturnValue(
      makeCursor([
        {
          electionId,
          primaryResults: {
            byParty: {
              uk_labour: candidates.map((c) => ({ candidateId: c._id.toString(), won: true })),
            },
            recordedAt: NOW,
          },
        },
      ])
    );

    const { resolvePrimariesIfNeeded } = await import("./primaryResolution");
    await resolvePrimariesIfNeeded(NOW, 100);

    const { initElectionVoteTally } = await import("@/lib/electionEngine");
    expect(initElectionVoteTally).not.toHaveBeenCalled();
    expect(db.collectionMocks["electionCandidates"].updateMany).not.toHaveBeenCalled();
  });

  it("does not reinitialize tally when JP parties already have only maxAdvancing candidates", async () => {
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      electionType: "shugiin",
      status: "active",
      countryId: "JP",
      state: "JP_TK",
      primaryEndTime: new Date(NOW.getTime() - 3600_000),
      endTime: new Date(NOW.getTime() + 3600_000),
    };

    const candidates = [1, 2, 3].map((i) => ({
      _id: new ObjectId(),
      electionId,
      party: "jp_ldp",
      characterName: `Cand${i}`,
      characterId: new ObjectId(),
      isNPP: false,
      status: "active",
    }));

    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));
    db.collectionMocks["politicalParties"] = db.collection("politicalParties");
    db.collectionMocks["politicalParties"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    db.collectionMocks["electionCandidates"].find.mockReturnValue(makeCursor(candidates));
    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    db.collectionMocks["electionVoteTallies"].find.mockReturnValue(
      makeCursor([
        {
          electionId,
          primaryResults: {
            byParty: {
              jp_ldp: candidates.map((c) => ({ candidateId: c._id.toString(), won: true })),
            },
            recordedAt: NOW,
          },
        },
      ])
    );

    const { resolvePrimariesIfNeeded } = await import("./primaryResolution");
    await resolvePrimariesIfNeeded(NOW, 100);

    const { initElectionVoteTally } = await import("@/lib/electionEngine");
    expect(initElectionVoteTally).not.toHaveBeenCalled();
    expect(db.collectionMocks["electionCandidates"].updateMany).not.toHaveBeenCalled();
  });

  // Ticket #1043: with redistricting on, US House advances top-3. A 2-candidate
  // Democratic primary must still stamp primaryResults (both won:true) so the
  // districted resolver can split the party's district wins by primary share —
  // and must NOT eliminate either nominee.
  it("stamps primaryResults for US House multi-advance without eliminating when under the cap", async () => {
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      electionType: "house",
      status: "active",
      countryId: "US",
      state: "NC",
      primaryEndTime: new Date(NOW.getTime() - 1000),
      endTime: new Date(NOW.getTime() + 100000),
    };
    const playerId = new ObjectId();
    const nppId = new ObjectId();
    const candidates = [
      {
        _id: playerId,
        electionId,
        party: "1",
        characterName: "Player",
        characterId: new ObjectId(),
        isNPP: false,
        status: "active",
      },
      {
        _id: nppId,
        electionId,
        party: "1",
        characterName: "NPP Co-nominee",
        characterId: new ObjectId(),
        nppId: new ObjectId(),
        isNPP: true,
        status: "active",
      },
      {
        _id: new ObjectId(),
        electionId,
        party: "2",
        characterName: "GOP",
        characterId: new ObjectId(),
        isNPP: true,
        nppId: new ObjectId(),
        status: "active",
      },
    ];

    db.collectionMocks["gameState"] = db.collection("gameState");
    db.collectionMocks["gameState"].findOne.mockResolvedValue({
      _id: "current",
      redistrictingEnabled: true,
    });
    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));
    db.collectionMocks["politicalParties"] = db.collection("politicalParties");
    db.collectionMocks["politicalParties"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    db.collectionMocks["electionCandidates"].find.mockReturnValue(makeCursor(candidates));
    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    db.collectionMocks["electionVoteTallies"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["characters"] = db.collection("characters");
    db.collectionMocks["characters"].find.mockReturnValue(
      makeCursor([{ _id: candidates[0].characterId, userId: new ObjectId() }])
    );

    const { fetchEnrichedCandidates } = await import("@/lib/electionEngine");
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue(
      candidates.map((c) => ({
        candidateId: c._id.toString(),
        charEP: 0,
        charSP: 0,
        favorability: 50,
        politicalInfluence: 100,
      })) as never
    );
    const { calcPrimaryScore } = await import("@/lib/primaryScore");
    vi.mocked(calcPrimaryScore)
      .mockReturnValueOnce(80)
      .mockReturnValueOnce(40)
      .mockReturnValueOnce(50);

    const { resolvePrimariesIfNeeded } = await import("./primaryResolution");
    await resolvePrimariesIfNeeded(NOW, 100);

    expect(db.collectionMocks["electionCandidates"].updateMany).not.toHaveBeenCalled();
    const { initElectionVoteTally } = await import("@/lib/electionEngine");
    expect(initElectionVoteTally).toHaveBeenCalled();
    const primaryResults = vi.mocked(initElectionVoteTally).mock.calls[0][3];
    const dem = primaryResults?.byParty?.["1"] ?? [];
    expect(dem).toHaveLength(2);
    expect(dem.every((e: { won: boolean }) => e.won)).toBe(true);
    expect(dem[0].candidateId).toBe(playerId.toString());
  });

  it("still eliminates losers when a UK party has more candidates than maxAdvancing", async () => {
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      electionType: "commons",
      status: "active",
      countryId: "UK",
      state: "SWE",
      primaryEndTime: new Date(NOW.getTime() - 3600_000),
      endTime: new Date(NOW.getTime() + 3600_000),
    };

    // 4 candidates in one party — UK advances 3, so exactly 1 loser expected.
    const candidates = [1, 2, 3, 4].map((i) => ({
      _id: new ObjectId(),
      electionId,
      party: "uk_labour",
      characterName: `Cand${i}`,
      characterId: new ObjectId(),
      isNPP: false,
      status: "active",
    }));

    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));
    db.collectionMocks["politicalParties"] = db.collection("politicalParties");
    db.collectionMocks["politicalParties"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    let findCall = 0;
    db.collectionMocks["electionCandidates"].find.mockImplementation(() => {
      findCall++;
      if (findCall === 1) return makeCursor(candidates);
      return makeCursor(candidates.slice(0, 3));
    });

    const { fetchEnrichedCandidates } = await import("@/lib/electionEngine");
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue(
      candidates.map((c) => ({
        candidateId: c._id.toString(),
        charEP: 0,
        charSP: 0,
        favorability: 50,
        politicalInfluence: 100,
      })) as never
    );

    const { calcPrimaryScore } = await import("@/lib/primaryScore");
    vi.mocked(calcPrimaryScore)
      .mockReturnValueOnce(90)
      .mockReturnValueOnce(80)
      .mockReturnValueOnce(70)
      .mockReturnValueOnce(10);

    db.collectionMocks["characters"] = db.collection("characters");
    db.collectionMocks["characters"].find.mockReturnValue(
      makeCursor(candidates.map((c) => ({ _id: c.characterId, userId: new ObjectId() })))
    );
    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    db.collectionMocks["electionVoteTallies"].findOne.mockResolvedValue(null);

    const { resolvePrimariesIfNeeded } = await import("./primaryResolution");
    await resolvePrimariesIfNeeded(NOW, 100);

    expect(db.collectionMocks["electionCandidates"].updateMany).toHaveBeenCalled();
    const withdrawCall = db.collectionMocks["electionCandidates"].updateMany.mock.calls[0];
    const withdrawnIds = withdrawCall[0]._id.$in.map((id: ObjectId) => id.toString());
    expect(withdrawnIds).toHaveLength(1);
    expect(withdrawnIds).toContain(candidates[3]._id.toString());
  });
});

describe("recordPrimarySnapshots", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns 0 when no elections in primary phase", async () => {
    const { recordPrimarySnapshots } = await import("./primaryResolution");
    const count = await recordPrimarySnapshots(NOW, 100);
    expect(count).toBe(0);
  });

  it("creates snapshots for elections with active primaries", async () => {
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      electionType: "senate",
      status: "active",
      countryId: "US",
      state: "CA",
      primaryEndTime: new Date(NOW.getTime() + 100000), // still in primary
    };

    const candidate = {
      _id: new ObjectId(),
      electionId,
      party: "DEM",
      characterName: "Alice",
      characterId: new ObjectId(),
      isNPP: false,
      status: "active",
    };

    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));
    db.collectionMocks["politicalParties"] = db.collection("politicalParties");
    db.collectionMocks["politicalParties"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    db.collectionMocks["electionCandidates"].find.mockReturnValue(makeCursor([candidate]));
    db.collectionMocks["characters"] = db.collection("characters");
    db.collectionMocks["characters"].find.mockReturnValue(
      makeCursor([
        {
          _id: candidate.characterId,
          policies: { economic: 3, social: -2 },
          favorability: 60,
          politicalInfluence: 100,
        },
      ])
    );
    db.collectionMocks["npps"] = db.collection("npps");
    db.collectionMocks["npps"].find.mockReturnValue(makeCursor([]));

    // Mock calcPrimaryScore to return a known value
    const { calcPrimaryScore } = await import("@/lib/primaryScore");
    vi.mocked(calcPrimaryScore).mockReturnValue(55);

    const { recordPrimarySnapshots } = await import("./primaryResolution");
    const count = await recordPrimarySnapshots(NOW, 100);

    expect(count).toBe(1);
    expect(db.collectionMocks["primarySnapshots"]!.insertMany).toHaveBeenCalled();
    const inserted = db.collectionMocks["primarySnapshots"]!.insertMany.mock.calls[0][0];
    expect(inserted).toHaveLength(1);
    expect(inserted[0].electionId).toEqual(electionId);
    expect(inserted[0].byParty.DEM).toBeDefined();
    expect(inserted[0].byParty.DEM[0].characterName).toBe("Alice");
  });
});

describe("accumulateGeneralElectionVotes", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("does nothing when no general-phase elections exist", async () => {
    const { accumulateGeneralElectionVotes } = await import("./primaryResolution");
    await accumulateGeneralElectionVotes(NOW, 10);

    const { accumulateVoteTurn } = await import("@/lib/electionEngine");
    expect(accumulateVoteTurn).not.toHaveBeenCalled();
  });

  it("accumulates votes for state elections past primary phase", async () => {
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      electionType: "senate",
      status: "active",
      countryId: "US",
      state: "CA",
      primaryEndTime: new Date(NOW.getTime() - 10000),
      endTime: new Date(NOW.getTime() + 100000),
    };

    const candidate = {
      _id: new ObjectId(),
      electionId,
      party: "DEM",
      characterName: "Alice",
      characterId: new ObjectId(),
      isNPP: false,
      status: "active",
    };

    // elections.find
    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));

    // Preload collections for state elections
    db.collectionMocks["demographicCategories"] = db.collection("demographicCategories");
    db.collectionMocks["demographicCategories"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["states"] = db.collection("states");
    db.collectionMocks["states"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["stateDemographics"] = db.collection("stateDemographics");
    db.collectionMocks["stateDemographics"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyOrg"] = db.collection("statePartyOrg");
    db.collectionMocks["statePartyOrg"].find.mockReturnValue(makeCursor([]));

    // Existing tallies and candidates
    const tally = { _id: new ObjectId(), electionId };
    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    db.collectionMocks["electionVoteTallies"].find.mockReturnValue(makeCursor([tally]));
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    db.collectionMocks["electionCandidates"].find.mockReturnValue(makeCursor([candidate]));

    const { accumulateGeneralElectionVotes } = await import("./primaryResolution");
    await accumulateGeneralElectionVotes(NOW, 10);

    const { accumulateVoteTurn } = await import("@/lib/electionEngine");
    expect(accumulateVoteTurn).toHaveBeenCalledWith(electionId, 10, NOW, expect.anything());
  });

  it("preloads a population-weighted national electorate for uachtaran", async () => {
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      electionType: "uachtaran",
      status: "active",
      countryId: "IE",
      state: "IE",
      primaryEndTime: new Date(NOW.getTime() - 10_000),
      endTime: new Date(NOW.getTime() + 100_000),
    };
    const candidate = {
      _id: new ObjectId(),
      electionId,
      party: "1",
      characterName: "Ronan",
      characterId: new ObjectId(),
      isNPP: false,
      status: "active",
    };
    const states = [
      {
        _id: "DUB",
        countryId: "IE",
        name: "Dublin",
        population: 100,
        votingEligiblePopulation: 80,
        gdp: 10,
        houseDistricts: 1,
        stateSenateSeats: 1,
        region: "Leinster",
      },
      {
        _id: "COR",
        countryId: "IE",
        name: "Cork",
        population: 300,
        votingEligiblePopulation: 240,
        gdp: 20,
        houseDistricts: 1,
        stateSenateSeats: 1,
        region: "Munster",
      },
    ];
    const demographics = [
      {
        _id: "DUB",
        countryId: "IE",
        categoryWeights: { ie_voterGroups: 100 },
        groups: {
          urban: { population: 70, economicLean: -2, socialLean: -1, turnout: 60 },
          rural: { population: 30, economicLean: 2, socialLean: 1, turnout: 80 },
        },
        lastUpdated: NOW,
      },
      {
        _id: "COR",
        countryId: "IE",
        categoryWeights: { ie_voterGroups: 100 },
        groups: {
          urban: { population: 30, economicLean: -1, socialLean: 0, turnout: 50 },
          rural: { population: 70, economicLean: 1, socialLean: 2, turnout: 70 },
        },
        lastUpdated: NOW,
      },
    ];
    const turnout = states.map((state, index) => ({
      _id: state._id,
      countryId: "IE",
      modifiers: { ie_voterGroups: { urban: index === 0 ? 4 : 0, rural: 0 } },
      lastDecayApplied: NOW,
      lastUpdated: NOW,
    }));
    const partyOrgs = states.map((state, index) => ({
      _id: `${state._id}_1`,
      countryId: "IE",
      stateId: state._id,
      partyId: "1",
      organization: index === 0 ? 20 : 80,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      treasury: 0,
      stateTaxRate: 0,
      politicalStrength: 0,
      updatedAt: NOW,
      hasPresence: true,
    }));

    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));
    db.collectionMocks["demographicCategories"] = db.collection("demographicCategories");
    db.collectionMocks["demographicCategories"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["states"] = db.collection("states");
    db.collectionMocks["states"].find.mockReturnValue(makeCursor(states));
    db.collectionMocks["stateDemographics"] = db.collection("stateDemographics");
    db.collectionMocks["stateDemographics"].find.mockReturnValue(makeCursor(demographics));
    db.collectionMocks["statePartyOrg"] = db.collection("statePartyOrg");
    db.collectionMocks["statePartyOrg"].find.mockReturnValue(makeCursor(partyOrgs));
    db.collectionMocks["stateDemographicTurnout"] = db.collection("stateDemographicTurnout");
    db.collectionMocks["stateDemographicTurnout"].find.mockReturnValue(makeCursor(turnout));
    db.collectionMocks["demographicDefaults"] = db.collection("demographicDefaults");
    db.collectionMocks["demographicDefaults"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    db.collectionMocks["electionVoteTallies"].find.mockReturnValue(
      makeCursor([{ _id: new ObjectId(), electionId }])
    );
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    db.collectionMocks["electionCandidates"].find.mockReturnValue(makeCursor([candidate]));

    const { accumulateGeneralElectionVotes } = await import("./primaryResolution");
    await accumulateGeneralElectionVotes(NOW, 10);

    const { accumulateVoteTurn } = await import("@/lib/electionEngine");
    const options = vi.mocked(accumulateVoteTurn).mock.calls[0]?.[3];
    expect(options?.preload?.stateMap.get("IE")).toMatchObject({
      _id: "IE",
      countryId: "IE",
      population: 400,
      votingEligiblePopulation: 320,
      votingSystem: "fptp",
    });
    expect(options?.preload?.demographicsMap.get("IE")?.groups.urban.population).toBeCloseTo(40);
    expect(options?.preload?.statePartyOrgsByState.get("IE")?.[0]?.organization).toBeCloseTo(65);
    expect(options?.preload?.turnoutByState.get("IE")?.modifiers.ie_voterGroups.urban).toBeCloseTo(
      1
    );
  });

  it("uses presidential engine for president elections", async () => {
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      electionType: "president",
      status: "active",
      countryId: "US",
      state: "US",
      primaryEndTime: new Date(NOW.getTime() - 10000),
      endTime: new Date(NOW.getTime() + 100000),
    };

    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));

    const tally = { _id: new ObjectId(), electionId };
    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    db.collectionMocks["electionVoteTallies"].find.mockReturnValue(makeCursor([tally]));
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    db.collectionMocks["electionCandidates"].find.mockReturnValue(makeCursor([]));

    const { accumulateGeneralElectionVotes } = await import("./primaryResolution");
    await accumulateGeneralElectionVotes(NOW, 10);

    const { accumulatePresidentVoteTurn } = await import("@/lib/presidentialElectionEngine");
    expect(accumulatePresidentVoteTurn).toHaveBeenCalledWith(electionId, 10, NOW);
  });

  it("bootstraps and catches up all due presidential waves in one turn", async () => {
    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const election = {
      _id: electionId,
      electionType: "president",
      status: "active",
      countryId: "US",
      state: "US",
      primaryEndTime: new Date(NOW.getTime() + 3 * 3_600_000),
      endTime: new Date(NOW.getTime() + 24 * 3_600_000),
    };
    const candidate = {
      _id: candidateId,
      electionId,
      party: "1",
      characterName: "Alice",
      characterId: new ObjectId(),
      isNPP: false,
      status: "active",
    };

    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockImplementation((query?: Record<string, unknown>) => {
      // processPrimaryStaggerWaves now scans active presidential primaries
      // without a primaryEndTime range (the turn-based due-check gates the
      // window in-memory), so match on type/status only.
      if (query?.electionType === "president") {
        return makeCursor([election]);
      }
      return makeCursor([]);
    });

    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    db.collectionMocks["electionCandidates"].find.mockReturnValue(makeCursor([candidate]));

    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    let tallyFindOneCalls = 0;
    db.collectionMocks["electionVoteTallies"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionVoteTallies"].findOne.mockImplementation(async () => {
      tallyFindOneCalls += 1;
      if (tallyFindOneCalls === 1) return null;
      const wavesRun = Math.min(tallyFindOneCalls - 2, 3);
      return {
        _id: electionId,
        electionId,
        state: "US",
        totalVotes: {},
        candidateNames: { [candidateId.toString()]: "Alice" },
        candidateParties: { [candidateId.toString()]: "1" },
        turnSnapshots: [],
        finalized: false,
        totalVotesByUnit: {},
        primaryWaveHistory: Array.from({ length: wavesRun }, (_, wave) => ({
          wave,
          turnsRemaining: [5, 4, 3][wave] ?? 0,
          statesVoted: wave === 0 ? ["IA"] : wave === 1 ? ["NH"] : wave === 2 ? ["NV", "SC"] : [],
          recordedAt: NOW,
        })),
        createdAt: NOW,
        updatedAt: NOW,
      };
    });

    db.collectionMocks["politicalParties"] = db.collection("politicalParties");
    db.collectionMocks["politicalParties"].find.mockReturnValue(
      makeCursor([
        {
          _id: "democrats",
          sequentialId: 1,
          countryId: "US",
          economicPosition: -2,
          socialPosition: -2,
          primaryCalendar: "dem",
        },
      ])
    );
    db.collectionMocks["demographicCategories"] = db.collection("demographicCategories");
    db.collectionMocks["demographicCategories"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["states"] = db.collection("states");
    db.collectionMocks["states"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["stateDemographics"] = db.collection("stateDemographics");
    db.collectionMocks["stateDemographics"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyOrg"] = db.collection("statePartyOrg");
    db.collectionMocks["statePartyOrg"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["stateDemographicTurnout"] = db.collection("stateDemographicTurnout");
    db.collectionMocks["stateDemographicTurnout"].find.mockReturnValue(makeCursor([]));

    const { fetchEnrichedCandidates } = await import("@/lib/electionEngine");
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue([
      {
        candidateId: candidateId.toString(),
        party: "1",
        isNPP: false,
        charEP: 0,
        charSP: 0,
        favorability: 55,
        politicalInfluence: 100,
      },
    ] as never);

    const { accumulateGeneralElectionVotes } = await import("./primaryResolution");
    await accumulateGeneralElectionVotes(NOW, 10);

    const { initPresidentVoteTally } = await import("@/lib/presidentialElectionEngine");
    expect(initPresidentVoteTally).toHaveBeenCalledWith(
      electionId,
      [candidate],
      undefined,
      expect.anything()
    );
    expect(db.collectionMocks["electionVoteTallies"].updateOne).toHaveBeenCalledTimes(3);
    expect(
      db.collectionMocks["electionVoteTallies"].updateOne.mock.calls.map(
        (call) => call[1].$push.primaryWaveHistory.statesVoted
      )
    ).toEqual([["IA"], ["NH"], ["NV", "SC"]]);
  });

  it("auto-creates missing tally for state elections", async () => {
    const electionId = new ObjectId();
    const election = {
      _id: electionId,
      electionType: "senate",
      status: "active",
      countryId: "US",
      state: "CA",
      primaryEndTime: new Date(NOW.getTime() - 10000),
      endTime: new Date(NOW.getTime() + 100000),
    };

    const candidate = {
      _id: new ObjectId(),
      electionId,
      characterName: "Alice",
      status: "active",
    };

    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));
    db.collectionMocks["demographicCategories"] = db.collection("demographicCategories");
    db.collectionMocks["demographicCategories"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["states"] = db.collection("states");
    db.collectionMocks["states"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["stateDemographics"] = db.collection("stateDemographics");
    db.collectionMocks["stateDemographics"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["statePartyOrg"] = db.collection("statePartyOrg");
    db.collectionMocks["statePartyOrg"].find.mockReturnValue(makeCursor([]));

    // No existing tally
    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    db.collectionMocks["electionVoteTallies"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    db.collectionMocks["electionCandidates"].find.mockReturnValue(makeCursor([candidate]));

    const { accumulateGeneralElectionVotes } = await import("./primaryResolution");
    await accumulateGeneralElectionVotes(NOW, 10);

    const { initElectionVoteTally } = await import("@/lib/electionEngine");
    expect(initElectionVoteTally).toHaveBeenCalledWith(electionId, [candidate], "CA");
  });
});
