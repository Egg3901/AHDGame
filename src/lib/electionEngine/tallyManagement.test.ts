/**
 * Tests for election vote tally accumulation and initialization.
 *
 * Covers:
 *  - initElectionVoteTally: blank document structure, upsert behaviour, primaryResults passthrough
 *  - accumulateVoteTurn: early-exit guards, turnPool computation, snapshot appending,
 *    totalVotes accumulation, withdrawn-candidate cleanup, seat estimation (Hamilton method),
 *    and the strengthMultiplier (approval × office strength) applied to effectiveTurnPool
 *  - removeWithdrawnCandidateFromTally (tallyCleaner): $unset paths, seatsEstimate cleanup
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  StateDemographics,
  State,
  DemographicCategory,
} from "@/lib/db/types";
import type { EnrichedCandidate } from "./types";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

vi.mock("./candidateEnrichment", () => ({
  fetchEnrichedCandidates: vi.fn(),
}));

vi.mock("./voteDistribution", () => ({
  distributeVotesByGroupLevelAllocation: vi.fn(),
}));

// #4G cutover: general elections now route through the §7.3.2 swing-flow
// engine by default. Each test below switches on the engine it actually
// intends to exercise by mocking the function its scenario will call —
// `distributeVotesBySwingFlow` for general phase, the legacy one for
// primaries. Both mocks fall back to a benign noop when not configured.
vi.mock("./voteDistributionSwingFlow", () => ({
  distributeVotesBySwingFlow: vi.fn(),
}));

vi.mock("./resolvedTurnout", () => ({
  resolveTurnout: vi.fn(),
  buildLiveTurnouts: vi.fn(),
  // Registered-voter gate: no pool doc in these fixtures, so passthrough — the
  // real function is identity when `unregistered` is absent.
  scalePoolToRegistered: (pool: number) => pool,
  // Real behavior, kept live in the mock: several tests pin the electorate
  // ceiling through the distributor's slice argument.
  capTurnSliceToElectorate: (slice: number, totalPool: number, electorate: number) =>
    totalPool > electorate && electorate > 0 ? slice * (electorate / totalPool) : slice,
  // Real behavior too: the cumulative ceiling is pinned through the slice.
  capTurnSliceToRemainingElectorate: (slice: number, alreadyCast: number, electorate: number) =>
    electorate > 0 ? Math.max(0, Math.min(slice, electorate - alreadyCast)) : slice,
}));

vi.mock("@/lib/utils/getStateApprovalForElection", () => ({
  getStateApprovalForElection: vi.fn(),
}));

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeElection(overrides: Partial<Election> = {}): Election {
  const now = new Date("2024-01-01T00:00:00Z");
  return {
    _id: new ObjectId(),
    countryId: "US",
    electionType: "senate",
    state: "PA",
    cycle: 1,
    status: "active",
    startTime: new Date(now.getTime() - 24 * 3_600_000), // 24h ago
    endTime: new Date(now.getTime() + 24 * 3_600_000), // 24h from now
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Election;
}

function makeCandidate(overrides: Partial<ElectionCandidate> = {}): ElectionCandidate {
  return {
    _id: new ObjectId(),
    electionId: new ObjectId(),
    characterId: new ObjectId(),
    characterName: "Test Candidate",
    party: "democrat",
    status: "active",
    isNPP: false,
    enteredAt: new Date(),
    ...overrides,
  } as ElectionCandidate;
}

function makeTally(
  electionId: ObjectId,
  overrides: Partial<ElectionVoteTally> = {}
): ElectionVoteTally {
  return {
    _id: electionId,
    electionId,
    state: "PA",
    totalVotes: {},
    candidateNames: {},
    candidateParties: {},
    turnSnapshots: [],
    finalized: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ElectionVoteTally;
}

function makeEnriched(
  candidateId: string,
  overrides: Partial<EnrichedCandidate> = {}
): EnrichedCandidate {
  return {
    candidateId,
    characterId: candidateId,
    characterName: "Test",
    party: "democrat",
    isNPP: false,
    charEP: 0,
    charSP: 0,
    favorability: 50,
    politicalInfluence: 100,
    nationalInfluence: 0,
    ...overrides,
  };
}

function makeDemographics(): StateDemographics {
  return {
    _id: "PA",
    countryId: "US",
    categoryWeights: { ideology: 100 },
    groups: {
      liberal: { population: 50, turnout: 60, economicLean: -3, socialLean: -3 },
      conservative: { population: 50, turnout: 60, economicLean: 3, socialLean: 3 },
    },
    lastUpdated: new Date(),
  };
}

function makeState(): State {
  return {
    _id: "PA",
    name: "Pennsylvania",
    countryId: "US",
    population: 1_000_000,
    votingSystem: "fptp",
  } as unknown as State;
}

function makeCategory(): DemographicCategory {
  return {
    _id: "ideology",
    name: "Ideology",
    defaultWeight: 100,
    groups: [
      {
        id: "liberal",
        name: "Liberals",
        defaultEconomicLean: -3,
        defaultSocialLean: -3,
        defaultTurnout: 60,
      },
      {
        id: "conservative",
        name: "Conservatives",
        defaultEconomicLean: 3,
        defaultSocialLean: 3,
        defaultTurnout: 60,
      },
    ],
  } as DemographicCategory;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let db: MockDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  for (const name of [
    "electionVoteTallies",
    "electionCandidates",
    "elections",
    "states",
    "stateDemographics",
    "demographicCategories",
    "statePartyOrg",
    "stateDemographicTurnout",
    "characters",
    "npps",
  ]) {
    db.collection(name);
  }
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

// ─── initElectionVoteTally ────────────────────────────────────────────────────
//
// initElectionVoteTally calls collection.replaceOne(), which is not in the
// MockCollection interface. We spy on the db.collection function to intercept
// the electionVoteTallies collection and inject a replaceOne mock.

function injectReplaceOne(db: MockDb): ReturnType<typeof vi.fn> {
  const replaceOneMock = vi.fn().mockResolvedValue({});
  (db.collectionMocks.electionVoteTallies as any).replaceOne = replaceOneMock;
  return replaceOneMock;
}

describe("initElectionVoteTally", () => {
  it("calls replaceOne with a zeroed tally document for each candidate", async () => {
    const { initElectionVoteTally } = await import("./tallyManagement");

    const replaceOne = injectReplaceOne(db);
    const electionId = new ObjectId();
    const c1 = makeCandidate({ _id: new ObjectId(), characterName: "Alice", party: "democrat" });
    const c2 = makeCandidate({ _id: new ObjectId(), characterName: "Bob", party: "republican" });

    await initElectionVoteTally(electionId, [c1, c2], "PA");

    expect(replaceOne).toHaveBeenCalledOnce();

    const [filter, doc, opts] = replaceOne.mock.calls[0];
    expect(filter).toEqual({ electionId });
    expect(opts).toEqual({ upsert: true });

    // All candidates start at 0 votes
    expect(doc.totalVotes[c1._id.toString()]).toBe(0);
    expect(doc.totalVotes[c2._id.toString()]).toBe(0);

    // Names and parties are populated
    expect(doc.candidateNames[c1._id.toString()]).toBe("Alice");
    expect(doc.candidateParties[c2._id.toString()]).toBe("republican");

    // Structural defaults
    expect(doc.state).toBe("PA");
    expect(doc.finalized).toBe(false);
    expect(doc.turnSnapshots).toEqual([]);
  });

  it("includes primaryResults in the tally when provided", async () => {
    const { initElectionVoteTally } = await import("./tallyManagement");

    const replaceOne = injectReplaceOne(db);
    const electionId = new ObjectId();
    const candidate = makeCandidate();
    const primaryResults = {
      byParty: {
        democrat: [
          {
            candidateId: "x",
            characterName: "Alice",
            party: "democrat",
            primaryScore: 100,
            sharePct: 100,
            won: true,
          },
        ],
      },
      recordedAt: new Date(),
    };

    await initElectionVoteTally(electionId, [candidate], "PA", primaryResults);

    const [, doc] = replaceOne.mock.calls[0];
    expect(doc.primaryResults).toEqual(primaryResults);
  });

  it("works with an empty candidate list (blank tally)", async () => {
    const { initElectionVoteTally } = await import("./tallyManagement");

    const replaceOne = injectReplaceOne(db);
    const electionId = new ObjectId();
    await initElectionVoteTally(electionId, [], "NY");

    const [, doc] = replaceOne.mock.calls[0];
    expect(doc.totalVotes).toEqual({});
    expect(doc.candidateNames).toEqual({});
    expect(doc.candidateParties).toEqual({});
  });
});

// ─── accumulateVoteTurn — early-exit guards ────────────────────────────────────

describe("accumulateVoteTurn — early exits", () => {
  it("returns without updating when tally is missing", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");

    const electionId = new ObjectId();
    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(null);
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([makeCandidate()]),
    });

    await accumulateVoteTurn(electionId, 1, new Date());

    expect(db.collectionMocks.electionVoteTallies.updateOne).not.toHaveBeenCalled();
  });

  it("returns without updating when there are no active candidates", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");

    const electionId = new ObjectId();
    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(makeTally(electionId));
    // No active candidates
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    await accumulateVoteTurn(electionId, 1, new Date());

    expect(db.collectionMocks.electionVoteTallies.updateOne).not.toHaveBeenCalled();
  });

  it("returns without updating when the election document is missing", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });

    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(makeTally(electionId));
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([candidate]),
    });
    db.collectionMocks.elections.findOne.mockResolvedValue(null);

    await accumulateVoteTurn(electionId, 1, new Date());

    expect(db.collectionMocks.electionVoteTallies.updateOne).not.toHaveBeenCalled();
  });

  it("returns without updating when election has no endTime", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });
    const election = makeElection({ _id: electionId, endTime: undefined });

    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(makeTally(electionId));
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([candidate]),
    });
    db.collectionMocks.elections.findOne.mockResolvedValue(election);

    await accumulateVoteTurn(electionId, 1, new Date());

    expect(db.collectionMocks.electionVoteTallies.updateOne).not.toHaveBeenCalled();
  });

  it("returns without updating when state document is missing", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");
    const { resolveTurnout } = await import("./resolvedTurnout");
    const { getStateApprovalForElection } = await import("@/lib/utils/getStateApprovalForElection");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });
    const election = makeElection({ _id: electionId });

    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(makeTally(electionId));
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([candidate]),
    });
    db.collectionMocks.elections.findOne.mockResolvedValue(election);
    db.collectionMocks.states.findOne.mockResolvedValue(null); // missing state
    db.collectionMocks.stateDemographics.findOne.mockResolvedValue(makeDemographics());
    db.collectionMocks.demographicCategories.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([makeCategory()]),
    });
    db.collectionMocks.statePartyOrg.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.stateDemographicTurnout.findOne.mockResolvedValue(null);

    vi.mocked(resolveTurnout).mockReturnValue({
      byGroup: { liberal: 60, conservative: 60 },
      totalPool: 600_000,
    });
    vi.mocked(getStateApprovalForElection).mockResolvedValue(50);

    await accumulateVoteTurn(electionId, 1, new Date());

    expect(db.collectionMocks.electionVoteTallies.updateOne).not.toHaveBeenCalled();
  });
});

// ─── accumulateVoteTurn — core vote accumulation ──────────────────────────────

describe("accumulateVoteTurn — vote accumulation", () => {
  /**
   * Wires all the happy-path mocks required for accumulateVoteTurn to proceed
   * past guards and reach the updateOne call.
   */
  async function setupHappyPath(opts: {
    electionId: ObjectId;
    candidates: ElectionCandidate[];
    election: Election;
    existingTallyVotes?: Record<string, number>;
    voteResult?: Record<string, number>;
    sharesPct?: Record<string, number>;
    totalPool?: number;
    approvalPct?: number;
  }) {
    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const { distributeVotesByGroupLevelAllocation } = await import("./voteDistribution");
    const { distributeVotesBySwingFlow } = await import("./voteDistributionSwingFlow");
    const { resolveTurnout } = await import("./resolvedTurnout");
    const { getStateApprovalForElection } = await import("@/lib/utils/getStateApprovalForElection");

    const existingVotes = opts.existingTallyVotes ?? {};
    const enriched = opts.candidates.map((c) => makeEnriched(c._id.toString()));
    const totalPool = opts.totalPool ?? 100_000;
    const voteResult =
      opts.voteResult ?? Object.fromEntries(enriched.map((e) => [e.candidateId, 5000]));
    const sharesPct =
      opts.sharesPct ?? Object.fromEntries(enriched.map((e) => [e.candidateId, 50]));

    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(
      makeTally(opts.electionId, {
        totalVotes: existingVotes,
        candidateNames: Object.fromEntries(
          opts.candidates.map((c) => [c._id.toString(), c.characterName])
        ),
        candidateParties: Object.fromEntries(
          opts.candidates.map((c) => [c._id.toString(), c.party])
        ),
      })
    );
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(opts.candidates),
    });
    db.collectionMocks.elections.findOne.mockResolvedValue(opts.election);
    db.collectionMocks.states.findOne.mockResolvedValue(makeState());
    db.collectionMocks.stateDemographics.findOne.mockResolvedValue(makeDemographics());
    db.collectionMocks.demographicCategories.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([makeCategory()]),
    });
    db.collectionMocks.statePartyOrg.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.stateDemographicTurnout.findOne.mockResolvedValue(null);

    vi.mocked(resolveTurnout).mockReturnValue({
      byGroup: { liberal: 60, conservative: 60 },
      totalPool,
    });
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue(enriched);
    vi.mocked(distributeVotesByGroupLevelAllocation).mockReturnValue({
      votesPerCandidate: voteResult,
      sharesPct,
    });
    // #4G cutover: general elections route through swing-flow by default.
    // Mock both engines to the same value so the test passes regardless
    // of which path is chosen.
    vi.mocked(distributeVotesBySwingFlow).mockReturnValue({
      votesPerCandidate: voteResult,
      sharesPct,
    });
    vi.mocked(getStateApprovalForElection).mockResolvedValue(opts.approvalPct ?? 50);
  }

  it("appends a VoteTurnSnapshot to turnSnapshots", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });
    const election = makeElection({ _id: electionId });

    await setupHappyPath({ electionId, candidates: [candidate], election });

    const now = new Date("2024-01-01T12:00:00Z");
    await accumulateVoteTurn(electionId, 7, now);

    expect(db.collectionMocks.electionVoteTallies.updateOne).toHaveBeenCalledOnce();
    const [, update] = db.collectionMocks.electionVoteTallies.updateOne.mock.calls[0];

    // $push must include turn and recordedAt
    const pushed = (update as { $push: { turnSnapshots: { turn: number; recordedAt: Date } } })
      .$push.turnSnapshots;
    expect(pushed.turn).toBe(7);
    expect(pushed.recordedAt).toBe(now);
  });

  it("passes election.countryId into candidate enrichment so OPS banned-party weights apply", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");
    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId, party: "2" });
    const election = makeElection({
      _id: electionId,
      countryId: "RU",
      electionType: "republicSupremeSoviet",
      state: "KAZ",
    });

    await setupHappyPath({ electionId, candidates: [candidate], election });
    await accumulateVoteTurn(electionId, 7, new Date("2024-01-01T12:00:00Z"));

    expect(fetchEnrichedCandidates).toHaveBeenCalledWith(expect.any(Array), {
      countryId: "RU",
    });
  });

  it("turn-first: a final-4-turn surges the vote pool even when the game clock has drifted", async () => {
    // Regression for fix/election-last-4: the 25% closing surge must key off
    // turn numbers, not the frozen `endTime` projection. Here `now` is held
    // constant (Date path would put both calls in the early band), but the turn
    // fields put turn 146 in the final-4 surge band of a 48-turn race. The
    // engine must hand the distribution a much larger turn pool for that turn.
    const { accumulateVoteTurn } = await import("./tallyManagement");
    const { distributeVotesBySwingFlow } = await import("./voteDistributionSwingFlow");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });
    // Drifted timestamps: a fixed `now` of start+10h lands in the EARLY band on
    // the Date path for any turn — so a date-based engine returns the same pool
    // for both calls and this test fails. Turn fields are the source of truth.
    const start = new Date("2024-01-01T00:00:00Z");
    const election = makeElection({
      _id: electionId,
      startTurn: 100,
      endTurn: 148, // 48-turn race
      startTime: start,
      endTime: new Date(start.getTime() + 48 * 3_600_000),
    });
    const now = new Date(start.getTime() + 10 * 3_600_000);

    await setupHappyPath({ electionId, candidates: [candidate], election, totalPool: 100_000 });

    // Early turn (turnIndex 10 of 48).
    await accumulateVoteTurn(electionId, 110, now);
    const earlyPool = vi.mocked(distributeVotesBySwingFlow).mock.calls.at(-1)![1] as number;

    // Final-stretch turn (turnIndex 46 → surge band).
    await accumulateVoteTurn(electionId, 146, now);
    const surgePool = vi.mocked(distributeVotesBySwingFlow).mock.calls.at(-1)![1] as number;

    // 25%/4 surge vs 75%/44 early ≈ 3.7×; assert a clear, drift-independent jump.
    expect(surgePool).toBeGreaterThan(earlyPool * 2);
  });

  it("caps the vote pool at the state's electorate (no 333%-of-VEP ballots)", async () => {
    // Audited engine defect: the resolved turnout pool could exceed the people
    // who exist (1956 certified 333% of the voting-eligible population). The
    // pool is now capped at the electorate — makeState() has population
    // 1,000,000 and no votingEligiblePopulation, so the ceiling is 1,000,000 —
    // and the per-turn slice rescales proportionally.
    const { accumulateVoteTurn } = await import("./tallyManagement");
    const { distributeVotesBySwingFlow } = await import("./voteDistributionSwingFlow");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });
    const start = new Date("2024-01-01T00:00:00Z");
    const election = makeElection({
      _id: electionId,
      startTurn: 100,
      endTurn: 148,
      startTime: start,
      endTime: new Date(start.getTime() + 48 * 3_600_000),
    });
    const now = new Date(start.getTime() + 10 * 3_600_000);

    // Baseline: a pool exactly at the ceiling.
    await setupHappyPath({ electionId, candidates: [candidate], election, totalPool: 1_000_000 });
    await accumulateVoteTurn(electionId, 110, now);
    const atCeilingCall = vi.mocked(distributeVotesBySwingFlow).mock.calls.at(-1)!;

    // Inflated: 3.3x the electorate must be clamped to the same values.
    await setupHappyPath({ electionId, candidates: [candidate], election, totalPool: 3_300_000 });
    await accumulateVoteTurn(electionId, 110, now);
    const inflatedCall = vi.mocked(distributeVotesBySwingFlow).mock.calls.at(-1)!;

    // Both runs must hand the distributor identical inputs. NOTE: in this
    // fixture the granular substrate rebuilds the pool below the ceiling in
    // BOTH runs, so the cap itself is inert here and these are equality pins;
    // the cap's actual algebra (slice scales, normalisation base untouched -
    // shrinking both cancels at the ballot) is pinned directly in
    // resolvedTurnout.scalePool.test.ts on capTurnSliceToElectorate.
    expect(inflatedCall[2]).toBeCloseTo(atCeilingCall[2] as number, 6);
    expect(inflatedCall[1]).toBeCloseTo(atCeilingCall[1] as number, 6);
  });

  it("does not bank the same turn twice when a stalled turn is re-run", async () => {
    // Live 2026-08-28: turn 460 stalled in corporationTurn, the lock was
    // cleared and the turn re-run twice under the same number; every open
    // general accrued three slices of turn 460. The tally already holding
    // this turn's snapshot is the tell.
    const { accumulateVoteTurn } = await import("./tallyManagement");
    const { distributeVotesBySwingFlow } = await import("./voteDistributionSwingFlow");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });
    const candidateId = candidate._id.toString();
    const election = makeElection({ _id: electionId, startTurn: 100, endTurn: 148 });
    await setupHappyPath({
      electionId,
      candidates: [candidate],
      election,
      existingTallyVotes: { [candidateId]: 10_000 },
    });
    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(
      makeTally(electionId, {
        totalVotes: { [candidateId]: 10_000 },
        candidateNames: { [candidateId]: candidate.characterName },
        candidateParties: { [candidateId]: candidate.party },
        turnSnapshots: [
          {
            turn: 110,
            recordedAt: new Date(),
            cumulativeVotes: { [candidateId]: 10_000 },
            sharesPct: { [candidateId]: 100 },
          },
        ],
      })
    );
    vi.mocked(distributeVotesBySwingFlow).mockClear();
    db.collectionMocks.electionVoteTallies.updateOne.mockClear();

    await accumulateVoteTurn(electionId, 110, new Date("2024-01-01T10:00:00Z"));
    expect(distributeVotesBySwingFlow).not.toHaveBeenCalled();
    expect(db.collectionMocks.electionVoteTallies.updateOne).not.toHaveBeenCalled();

    // The next turn counts normally.
    await accumulateVoteTurn(electionId, 111, new Date("2024-01-01T11:00:00Z"));
    expect(distributeVotesBySwingFlow).toHaveBeenCalledTimes(1);
  });

  it("counts the turn that reaches endTurn and releases exactly the pool across the window", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");
    const { distributeVotesBySwingFlow } = await import("./voteDistributionSwingFlow");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });
    const start = new Date("2024-01-01T00:00:00Z");
    const election = makeElection({
      _id: electionId,
      startTurn: 100,
      endTurn: 148,
      startTime: start,
      endTime: new Date(start.getTime() + 48 * 3_600_000),
    });
    await setupHappyPath({ electionId, candidates: [candidate], election, totalPool: 100_000 });

    // Accumulation runs on every turn from start THROUGH endTurn (timers
    // complete the race after this phase), so 100..148 is 49 slices. Before
    // the inclusive window the 49th turn was clamped onto the final slice and
    // re-released it: 12-turn generals paid out 13 slices (102% turnout).
    let released = 0;
    let firstSlice = 0;
    for (let turn = 100; turn <= 148; turn++) {
      vi.mocked(distributeVotesBySwingFlow).mockClear();
      await accumulateVoteTurn(electionId, turn, start);
      expect(distributeVotesBySwingFlow).toHaveBeenCalledTimes(1);
      const slice = vi.mocked(distributeVotesBySwingFlow).mock.calls[0][1] as number;
      if (turn === 100) firstSlice = slice;
      released += slice;
    }
    // Scale-free conservation check (the office-strength multiplier scales
    // every slice alike): over 49 turns the early band is 37 turns carrying
    // 50% of the pool, so the whole window is exactly 74 first slices. A
    // re-released final slice would add a 75th.
    expect(released / firstSlice).toBeCloseTo(74, 6);
  });

  it("never carries cumulative ballots past the electorate", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");
    const { distributeVotesBySwingFlow } = await import("./voteDistributionSwingFlow");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });
    const start = new Date("2024-01-01T00:00:00Z");
    const election = makeElection({
      _id: electionId,
      startTurn: 100,
      endTurn: 148,
      startTime: start,
      endTime: new Date(start.getTime() + 48 * 3_600_000),
    });
    // makeState() has 1,000,000 people and no registration pool, so the
    // ceiling is 1,000,000; 999,500 are already on the board.
    await setupHappyPath({
      electionId,
      candidates: [candidate],
      election,
      existingTallyVotes: { [candidate._id.toString()]: 999_500 },
      totalPool: 1_000_000,
    });

    // Surge band: the uncapped slice would be tens of thousands of ballots.
    await accumulateVoteTurn(electionId, 146, start);
    const slice = vi.mocked(distributeVotesBySwingFlow).mock.calls.at(-1)![1] as number;
    expect(slice).toBeGreaterThan(0);
    expect(slice).toBeLessThanOrEqual(500);
  });

  it("accumulates votes on top of existing totals", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });
    const candidateId = candidate._id.toString();
    const election = makeElection({ _id: electionId });

    // Pre-existing 10 000 votes for this candidate
    await setupHappyPath({
      electionId,
      candidates: [candidate],
      election,
      existingTallyVotes: { [candidateId]: 10_000 },
      voteResult: { [candidateId]: 3_000 }, // this turn adds 3 000
    });

    await accumulateVoteTurn(electionId, 2, new Date());

    const [, update] = db.collectionMocks.electionVoteTallies.updateOne.mock.calls[0];
    const newTotals = (update as { $set: { totalVotes: Record<string, number> } }).$set.totalVotes;

    // Should sum to 13 000
    expect(newTotals[candidateId]).toBe(13_000);
  });

  it("excludes withdrawn candidates from totalVotes", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");
    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const { distributeVotesByGroupLevelAllocation } = await import("./voteDistribution");

    const electionId = new ObjectId();
    const activeCand = makeCandidate({ electionId, status: "active" });
    const withdrawnCand = makeCandidate({ electionId, status: "withdrawn" });
    const election = makeElection({ _id: electionId });

    // The DB returns only active candidates (status filter in query)
    // The withdrawn candidate had prior votes in the tally
    const activeId = activeCand._id.toString();
    const withdrawnId = withdrawnCand._id.toString();

    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(
      makeTally(electionId, {
        totalVotes: { [activeId]: 5_000, [withdrawnId]: 2_000 },
        candidateNames: { [activeId]: "Active", [withdrawnId]: "Withdrawn" },
        candidateParties: { [activeId]: "democrat", [withdrawnId]: "republican" },
      })
    );
    // Only active candidate comes back from the DB query
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([activeCand]),
    });
    db.collectionMocks.elections.findOne.mockResolvedValue(election);
    db.collectionMocks.states.findOne.mockResolvedValue(makeState());
    db.collectionMocks.stateDemographics.findOne.mockResolvedValue(makeDemographics());
    db.collectionMocks.demographicCategories.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([makeCategory()]),
    });
    db.collectionMocks.statePartyOrg.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.stateDemographicTurnout.findOne.mockResolvedValue(null);

    const { resolveTurnout } = await import("./resolvedTurnout");
    const { getStateApprovalForElection } = await import("@/lib/utils/getStateApprovalForElection");
    vi.mocked(resolveTurnout).mockReturnValue({ byGroup: {}, totalPool: 100_000 });
    vi.mocked(getStateApprovalForElection).mockResolvedValue(50);
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue([makeEnriched(activeId)]);
    vi.mocked(distributeVotesByGroupLevelAllocation).mockReturnValue({
      votesPerCandidate: { [activeId]: 1_000 },
      sharesPct: { [activeId]: 100 },
    });
    const { distributeVotesBySwingFlow } = await import("./voteDistributionSwingFlow");
    vi.mocked(distributeVotesBySwingFlow).mockReturnValue({
      votesPerCandidate: { [activeId]: 1_000 },
      sharesPct: { [activeId]: 100 },
    });

    await accumulateVoteTurn(electionId, 3, new Date());

    const [, update] = db.collectionMocks.electionVoteTallies.updateOne.mock.calls[0];
    const newTotals = (update as { $set: { totalVotes: Record<string, number> } }).$set.totalVotes;

    // Active candidate gets accumulated votes; withdrawn candidate should NOT appear
    expect(newTotals[activeId]).toBe(6_000);
    expect(newTotals[withdrawnId]).toBeUndefined();

    // candidateNames for withdrawn must also be pruned
    const { candidateNames } = (update as { $set: { candidateNames: Record<string, string> } })
      .$set;
    expect(candidateNames[withdrawnId]).toBeUndefined();
    expect(candidateNames[activeId]).toBeDefined();
  });

  it("snapshot cumulativeVotes reflects the new totalVotes (not the pre-existing amounts)", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });
    const candidateId = candidate._id.toString();
    const election = makeElection({ _id: electionId });

    await setupHappyPath({
      electionId,
      candidates: [candidate],
      election,
      existingTallyVotes: { [candidateId]: 8_000 },
      voteResult: { [candidateId]: 2_000 },
    });

    await accumulateVoteTurn(electionId, 5, new Date());

    const [, update] = db.collectionMocks.electionVoteTallies.updateOne.mock.calls[0];
    const snapshot = (
      update as { $push: { turnSnapshots: { cumulativeVotes: Record<string, number> } } }
    ).$push.turnSnapshots;
    // 8000 existing + 2000 this turn = 10000
    expect(snapshot.cumulativeVotes[candidateId]).toBe(10_000);
  });

  it("passes sharesPct from vote distribution into the snapshot", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });
    const candidateId = candidate._id.toString();
    const election = makeElection({ _id: electionId });

    await setupHappyPath({
      electionId,
      candidates: [candidate],
      election,
      sharesPct: { [candidateId]: 73.5 },
    });

    await accumulateVoteTurn(electionId, 1, new Date());

    const [, update] = db.collectionMocks.electionVoteTallies.updateOne.mock.calls[0];
    const snapshot = (update as { $push: { turnSnapshots: { sharesPct: Record<string, number> } } })
      .$push.turnSnapshots;
    expect(snapshot.sharesPct[candidateId]).toBe(73.5);
  });

  it("coattail gate uses parties in the race, not StatePartyOrg rows (2026-07-09 fix)", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");
    const { distributeVotesBySwingFlow } = await import("./voteDistributionSwingFlow");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId, party: "democrat" });
    const election = makeElection({ _id: electionId }); // senate → down-ballot general

    await setupHappyPath({ electionId, candidates: [candidate], election });

    // Sitting President is a Democrat — the party IS in the race (our sole
    // candidate) but has NO StatePartyOrg row (setupHappyPath seeds an empty
    // statePartyOrg collection). Pre-fix the engine gated the coattail on
    // org-row keys and wrongly suppressed it; the display path in
    // enrichElection.ts gates on parties actually in the race.
    db.collection("electedOfficials");
    db.collection("governmentApprovals");
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue({
      countryId: "US",
      officeType: "president",
      party: "democrat",
    });
    db.collectionMocks.governmentApprovals.findOne.mockResolvedValue({
      _id: "US",
      approvalRating: 70,
    });

    await accumulateVoteTurn(electionId, 1, new Date());

    const lastCall = vi.mocked(distributeVotesBySwingFlow).mock.calls.at(-1)!;
    const options = lastCall[7] as { presidentialModifierByParty?: Map<string, number> };
    expect(options.presidentialModifierByParty).toBeDefined();
    expect(options.presidentialModifierByParty!.has("democrat")).toBe(true);
    // 70% approval → boosting multiplier (> 1).
    expect(options.presidentialModifierByParty!.get("democrat")!).toBeGreaterThan(1);
  });
});

// ─── accumulateVoteTurn — seat estimation (Hamilton method) ───────────────────

describe("accumulateVoteTurn — Hamilton seat allocation for multi-seat races", () => {
  async function setupMultiSeat(opts: {
    electionId: ObjectId;
    electionType: string;
    totalSeats: number;
    candidateVotes: Record<string, number>;
  }) {
    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const { distributeVotesByGroupLevelAllocation } = await import("./voteDistribution");
    const { distributeVotesBySwingFlow } = await import("./voteDistributionSwingFlow");
    const { resolveTurnout } = await import("./resolvedTurnout");
    const { getStateApprovalForElection } = await import("@/lib/utils/getStateApprovalForElection");

    const _candidates = Object.keys(opts.candidateVotes).map((_id) => {
      const c = makeCandidate({ _id: new ObjectId() });
      // We need to control _id; re-create using the id string as a label on enriched
      return c;
    });

    // Build with controlled IDs
    const controlledCandidates = Object.keys(opts.candidateVotes).map((label, _i) => {
      const id = new ObjectId();
      return makeCandidate({ _id: id, characterName: label });
    });

    const enrichedList = controlledCandidates.map((c) =>
      makeEnriched(c._id.toString(), { characterName: c.characterName })
    );

    // Map label → candidateId
    const labelToId: Record<string, string> = {};
    for (let i = 0; i < controlledCandidates.length; i++) {
      labelToId[controlledCandidates[i].characterName] = controlledCandidates[i]._id.toString();
    }

    const votesByLabel = opts.candidateVotes;
    const voteResult: Record<string, number> = {};
    for (const [label, votes] of Object.entries(votesByLabel)) {
      voteResult[labelToId[label]] = votes;
    }

    const election = makeElection({
      _id: opts.electionId,
      electionType: opts.electionType,
      totalSeats: opts.totalSeats,
    });

    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(makeTally(opts.electionId));
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(controlledCandidates),
    });
    db.collectionMocks.elections.findOne.mockResolvedValue(election);
    db.collectionMocks.states.findOne.mockResolvedValue(makeState());
    db.collectionMocks.stateDemographics.findOne.mockResolvedValue(makeDemographics());
    db.collectionMocks.demographicCategories.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([makeCategory()]),
    });
    db.collectionMocks.statePartyOrg.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.stateDemographicTurnout.findOne.mockResolvedValue(null);

    vi.mocked(resolveTurnout).mockReturnValue({ byGroup: {}, totalPool: 100_000 });
    vi.mocked(getStateApprovalForElection).mockResolvedValue(50);
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue(enrichedList);
    vi.mocked(distributeVotesByGroupLevelAllocation).mockReturnValue({
      votesPerCandidate: voteResult,
      sharesPct: {},
    });
    // #4G cutover: general elections route through swing-flow by default.
    vi.mocked(distributeVotesBySwingFlow).mockReturnValue({
      votesPerCandidate: voteResult,
      sharesPct: {},
    });

    return { labelToId };
  }

  it("produces seatsEstimate that sums exactly to totalSeats", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");

    const electionId = new ObjectId();
    const { labelToId: _labelToId } = await setupMultiSeat({
      electionId,
      electionType: "stateSenate",
      totalSeats: 5,
      candidateVotes: { Alice: 40_000, Bob: 30_000, Carol: 20_000, Dave: 10_000 },
    });

    await accumulateVoteTurn(electionId, 1, new Date());

    const [, update] = db.collectionMocks.electionVoteTallies.updateOne.mock.calls[0];
    const seats = (update as { $set: { seatsEstimate: Record<string, number> } }).$set
      .seatsEstimate;

    expect(seats).toBeDefined();
    const total = Object.values(seats!).reduce((s, n) => s + n, 0);
    expect(total).toBe(5);

    const snapshot = (
      update as { $push: { turnSnapshots: { seatsEstimate?: Record<string, number> } } }
    ).$push.turnSnapshots;
    expect(snapshot.seatsEstimate).toEqual(seats);
  });

  it("gives the candidate with the most votes the most seats", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");

    const electionId = new ObjectId();
    // 75% vs 25% split over 5 seats → Leader gets 3-4, Runner gets 1-2
    const { labelToId } = await setupMultiSeat({
      electionId,
      electionType: "stateSenate",
      totalSeats: 5,
      candidateVotes: { Leader: 75_000, Runner: 25_000 },
    });

    await accumulateVoteTurn(electionId, 1, new Date());

    const [, update] = db.collectionMocks.electionVoteTallies.updateOne.mock.calls[0];
    const seats = (update as { $set: { seatsEstimate: Record<string, number> } }).$set
      .seatsEstimate;

    const leaderSeats = seats![labelToId["Leader"]];
    const runnerSeats = seats![labelToId["Runner"]];
    expect(leaderSeats).toBeGreaterThan(runnerSeats);
  });

  it("excludes candidate below 20% threshold from house seat allocation", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");

    const electionId = new ObjectId();
    // Fringe gets 5% of 100k = 5000 votes — below 20% threshold for 'house'
    const { labelToId } = await setupMultiSeat({
      electionId,
      electionType: "house",
      totalSeats: 3,
      candidateVotes: { Major1: 50_000, Major2: 45_000, Fringe: 5_000 },
    });

    await accumulateVoteTurn(electionId, 1, new Date());

    const [, update] = db.collectionMocks.electionVoteTallies.updateOne.mock.calls[0];
    const seats = (update as { $set: { seatsEstimate: Record<string, number> } }).$set
      .seatsEstimate;

    // Fringe is below threshold — should receive 0 seats
    expect(seats![labelToId["Fringe"]]).toBe(0);
    // All 3 seats go to the two major candidates
    const major1Seats = seats![labelToId["Major1"]];
    const major2Seats = seats![labelToId["Major2"]];
    expect(major1Seats + major2Seats).toBe(3);
  });

  it("does not write seatsEstimate for single-seat races (senate)", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");

    const electionId = new ObjectId();
    await setupMultiSeat({
      electionId,
      electionType: "senate", // single-seat — not in MULTI_SEAT_TYPES
      totalSeats: 1,
      candidateVotes: { Alice: 60_000, Bob: 40_000 },
    });

    await accumulateVoteTurn(electionId, 1, new Date());

    const [, update] = db.collectionMocks.electionVoteTallies.updateOne.mock.calls[0];
    const $set = (update as { $set: Record<string, unknown> }).$set;
    expect($set.seatsEstimate).toBeUndefined();
  });

  it("does not write seatsEstimate when totalSeats is missing", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");
    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const { distributeVotesByGroupLevelAllocation } = await import("./voteDistribution");
    await import("./voteDistributionSwingFlow");
    const { resolveTurnout } = await import("./resolvedTurnout");
    const { getStateApprovalForElection } = await import("@/lib/utils/getStateApprovalForElection");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });

    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(makeTally(electionId));
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([candidate]),
    });
    // house type but NO totalSeats field
    db.collectionMocks.elections.findOne.mockResolvedValue(
      makeElection({ _id: electionId, electionType: "house", totalSeats: undefined })
    );
    db.collectionMocks.states.findOne.mockResolvedValue(makeState());
    db.collectionMocks.stateDemographics.findOne.mockResolvedValue(makeDemographics());
    db.collectionMocks.demographicCategories.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([makeCategory()]),
    });
    db.collectionMocks.statePartyOrg.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.stateDemographicTurnout.findOne.mockResolvedValue(null);

    vi.mocked(resolveTurnout).mockReturnValue({ byGroup: {}, totalPool: 100_000 });
    vi.mocked(getStateApprovalForElection).mockResolvedValue(50);
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue([makeEnriched(candidate._id.toString())]);
    vi.mocked(distributeVotesByGroupLevelAllocation).mockReturnValue({
      votesPerCandidate: { [candidate._id.toString()]: 5_000 },
      sharesPct: { [candidate._id.toString()]: 100 },
    });

    await accumulateVoteTurn(electionId, 1, new Date());

    const [, update] = db.collectionMocks.electionVoteTallies.updateOne.mock.calls[0];
    const $set = (update as { $set: Record<string, unknown> }).$set;
    expect($set.seatsEstimate).toBeUndefined();
  });
});

// ─── accumulateVoteTurn — preload path ────────────────────────────────────────

describe("accumulateVoteTurn — preload option", () => {
  it("uses preloaded state and demographics instead of DB queries", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");
    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const { distributeVotesByGroupLevelAllocation } = await import("./voteDistribution");
    await import("./voteDistributionSwingFlow");
    const { resolveTurnout } = await import("./resolvedTurnout");
    const { getStateApprovalForElection } = await import("@/lib/utils/getStateApprovalForElection");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });
    const candidateId = candidate._id.toString();
    const election = makeElection({ _id: electionId });

    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(makeTally(electionId));
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([candidate]),
    });
    db.collectionMocks.elections.findOne.mockResolvedValue(election);

    const preloadedState = makeState();
    const preloadedDemographics = makeDemographics();
    const preloadedCategories = [makeCategory()];

    vi.mocked(resolveTurnout).mockReturnValue({ byGroup: {}, totalPool: 80_000 });
    vi.mocked(getStateApprovalForElection).mockResolvedValue(50);
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue([makeEnriched(candidateId)]);
    vi.mocked(distributeVotesByGroupLevelAllocation).mockReturnValue({
      votesPerCandidate: { [candidateId]: 2_000 },
      sharesPct: { [candidateId]: 100 },
    });

    await accumulateVoteTurn(electionId, 1, new Date(), {
      preload: {
        stateMap: new Map([["PA", preloadedState]]),
        demographicsMap: new Map([["PA", preloadedDemographics]]),
        categories: preloadedCategories,
        statePartyOrgsByState: new Map(),
        turnoutByState: new Map(),
      },
    });

    // State and stateDemographics should NOT have been queried from DB
    expect(db.collectionMocks.states.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.stateDemographics.findOne).not.toHaveBeenCalled();
    // But updateOne should still have been called (accumulation succeeded)
    expect(db.collectionMocks.electionVoteTallies.updateOne).toHaveBeenCalledOnce();
  });
});

// ─── accumulateVoteTurn — approvalMap option ──────────────────────────────────

describe("accumulateVoteTurn — approvalMap option", () => {
  it("uses approval from the map rather than calling getStateApprovalForElection", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");
    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const { distributeVotesByGroupLevelAllocation } = await import("./voteDistribution");
    await import("./voteDistributionSwingFlow");
    const { resolveTurnout } = await import("./resolvedTurnout");
    const { getStateApprovalForElection } = await import("@/lib/utils/getStateApprovalForElection");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });
    const election = makeElection({ _id: electionId });

    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(makeTally(electionId));
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([candidate]),
    });
    db.collectionMocks.elections.findOne.mockResolvedValue(election);
    db.collectionMocks.states.findOne.mockResolvedValue(makeState());
    db.collectionMocks.stateDemographics.findOne.mockResolvedValue(makeDemographics());
    db.collectionMocks.demographicCategories.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([makeCategory()]),
    });
    db.collectionMocks.statePartyOrg.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.stateDemographicTurnout.findOne.mockResolvedValue(null);

    vi.mocked(resolveTurnout).mockReturnValue({ byGroup: {}, totalPool: 100_000 });
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue([makeEnriched(candidate._id.toString())]);
    vi.mocked(distributeVotesByGroupLevelAllocation).mockReturnValue({
      votesPerCandidate: { [candidate._id.toString()]: 1_000 },
      sharesPct: {},
    });

    const approvalMap = new Map([["PA", 70]]);

    await accumulateVoteTurn(electionId, 1, new Date(), { approvalMap });

    // DB-hitting fallback should NOT have been called
    expect(vi.mocked(getStateApprovalForElection)).not.toHaveBeenCalled();
    // Accumulation should still succeed
    expect(db.collectionMocks.electionVoteTallies.updateOne).toHaveBeenCalledOnce();
  });
});

// ─── tallyCleaner: removeWithdrawnCandidateFromTally ─────────────────────────

describe("removeWithdrawnCandidateFromTally", () => {
  it("returns early without updating when tally does not exist", async () => {
    const { removeWithdrawnCandidateFromTally } = await import("./tallyCleaner");

    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(null);

    const electionId = new ObjectId();
    await removeWithdrawnCandidateFromTally(db as unknown as Db, electionId, "cand1");

    expect(db.collectionMocks.electionVoteTallies.updateOne).not.toHaveBeenCalled();
  });

  it("builds $unset paths for totalVotes, candidateNames, and candidateParties", async () => {
    const { removeWithdrawnCandidateFromTally } = await import("./tallyCleaner");

    const electionId = new ObjectId();
    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(
      makeTally(electionId, {
        totalVotes: { cand1: 5_000, cand2: 3_000 },
        candidateNames: { cand1: "Alice", cand2: "Bob" },
        candidateParties: { cand1: "democrat", cand2: "republican" },
      })
    );

    await removeWithdrawnCandidateFromTally(db as unknown as Db, electionId, "cand1");

    expect(db.collectionMocks.electionVoteTallies.updateOne).toHaveBeenCalledOnce();
    const [, update] = db.collectionMocks.electionVoteTallies.updateOne.mock.calls[0];
    const $unset = (update as { $unset: Record<string, ""> }).$unset;

    expect($unset["totalVotes.cand1"]).toBe("");
    expect($unset["candidateNames.cand1"]).toBe("");
    expect($unset["candidateParties.cand1"]).toBe("");

    // cand2 paths must NOT be unset
    expect($unset["totalVotes.cand2"]).toBeUndefined();
  });

  it("also unsets seatsEstimate entry when the candidate is present there", async () => {
    const { removeWithdrawnCandidateFromTally } = await import("./tallyCleaner");

    const electionId = new ObjectId();
    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(
      makeTally(electionId, {
        totalVotes: { cand1: 5_000 },
        candidateNames: { cand1: "Alice" },
        candidateParties: { cand1: "democrat" },
        seatsEstimate: { cand1: 2, cand2: 1 },
      })
    );

    await removeWithdrawnCandidateFromTally(db as unknown as Db, electionId, "cand1");

    const [, update] = db.collectionMocks.electionVoteTallies.updateOne.mock.calls[0];
    const $unset = (update as { $unset: Record<string, ""> }).$unset;

    expect($unset["seatsEstimate.cand1"]).toBe("");
    // cand2 seat entry must NOT be touched
    expect($unset["seatsEstimate.cand2"]).toBeUndefined();
  });

  it("does not include seatsEstimate path when candidate has no seat entry", async () => {
    const { removeWithdrawnCandidateFromTally } = await import("./tallyCleaner");

    const electionId = new ObjectId();
    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(
      makeTally(electionId, {
        totalVotes: { cand1: 5_000 },
        candidateNames: { cand1: "Alice" },
        candidateParties: { cand1: "democrat" },
        // seatsEstimate does not include cand1
        seatsEstimate: { cand2: 3 },
      })
    );

    await removeWithdrawnCandidateFromTally(db as unknown as Db, electionId, "cand1");

    const [, update] = db.collectionMocks.electionVoteTallies.updateOne.mock.calls[0];
    const $unset = (update as { $unset: Record<string, ""> }).$unset;

    expect($unset["seatsEstimate.cand1"]).toBeUndefined();
  });

  it("does not include seatsEstimate path when tally has no seatsEstimate at all", async () => {
    const { removeWithdrawnCandidateFromTally } = await import("./tallyCleaner");

    const electionId = new ObjectId();
    // seatsEstimate is absent (single-seat race)
    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(
      makeTally(electionId, {
        totalVotes: { cand1: 5_000 },
        candidateNames: { cand1: "Alice" },
        candidateParties: { cand1: "democrat" },
      })
    );

    await removeWithdrawnCandidateFromTally(db as unknown as Db, electionId, "cand1");

    const [, update] = db.collectionMocks.electionVoteTallies.updateOne.mock.calls[0];
    const $unset = (update as { $unset: Record<string, ""> }).$unset;

    // Only the 3 standard paths
    expect(Object.keys($unset)).toHaveLength(3);
    expect($unset["seatsEstimate.cand1"]).toBeUndefined();
  });

  it("sets updatedAt in the $set portion of the update", async () => {
    const { removeWithdrawnCandidateFromTally } = await import("./tallyCleaner");

    const electionId = new ObjectId();
    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(
      makeTally(electionId, {
        totalVotes: { cand1: 100 },
        candidateNames: { cand1: "X" },
        candidateParties: { cand1: "x" },
      })
    );

    const before = new Date();
    await removeWithdrawnCandidateFromTally(db as unknown as Db, electionId, "cand1");
    const after = new Date();

    const [, update] = db.collectionMocks.electionVoteTallies.updateOne.mock.calls[0];
    const $set = (update as { $set: { updatedAt: Date } }).$set;
    expect($set.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect($set.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ─── accumulateVoteTurn — granular electorate substrate wiring ────────────────
//
// Coalesced Layer-1 cells are the substrate the engine receives, with the
// archetype-keyed inputs remapped onto them. There is no flag any more: every
// country has a Layer-1 model, so the archetype substrate was unreachable as an
// engine choice and survived only as a way to turn the real electorate off.
//
// A state with NO census row still passes its fixtures through untouched — that
// is a data-integrity fallback (newly admitted state, mid-migration), not an
// engine selection, and it is what the second test now pins.

describe("accumulateVoteTurn — granular electorate substrate", () => {
  async function setupForFlag(opts: {
    gameState: Record<string, unknown> | null;
    /** Election's state id. Defaults to the PA fixture, which HAS a census. */
    state?: string;
  }) {
    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const { distributeVotesByGroupLevelAllocation } = await import("./voteDistribution");
    const { distributeVotesBySwingFlow } = await import("./voteDistributionSwingFlow");
    const { resolveTurnout } = await import("./resolvedTurnout");
    const { getStateApprovalForElection } = await import("@/lib/utils/getStateApprovalForElection");

    const electionId = new ObjectId();
    const candidate = makeCandidate({ electionId });
    const election = makeElection({
      _id: electionId,
      ...(opts.state ? { state: opts.state } : {}),
    });
    const enriched = [makeEnriched(candidate._id.toString())];

    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue(opts.gameState);
    db.collectionMocks.electionVoteTallies.findOne.mockResolvedValue(
      makeTally(electionId, {
        totalVotes: { [candidate._id.toString()]: 0 },
        candidateNames: { [candidate._id.toString()]: candidate.characterName },
        candidateParties: { [candidate._id.toString()]: candidate.party },
      })
    );
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([candidate]),
    });
    db.collectionMocks.elections.findOne.mockResolvedValue(election);
    db.collectionMocks.states.findOne.mockResolvedValue(makeState());
    db.collectionMocks.stateDemographics.findOne.mockResolvedValue(makeDemographics());
    db.collectionMocks.demographicCategories.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([makeCategory()]),
    });
    db.collectionMocks.statePartyOrg.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.stateDemographicTurnout.findOne.mockResolvedValue(null);

    vi.mocked(resolveTurnout).mockReturnValue({
      byGroup: { liberal: 60, conservative: 60 },
      totalPool: 600_000,
    });
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue(enriched);
    const voteResult = { [candidate._id.toString()]: 5000 };
    const sharesPct = { [candidate._id.toString()]: 100 };
    vi.mocked(distributeVotesByGroupLevelAllocation).mockReturnValue({
      votesPerCandidate: voteResult,
      sharesPct,
    });
    vi.mocked(distributeVotesBySwingFlow).mockReturnValue({
      votesPerCandidate: voteResult,
      sharesPct,
    });
    vi.mocked(getStateApprovalForElection).mockResolvedValue(50);

    return { electionId };
  }

  it("flag ON: engine receives the granular-cell substrate (PA has a Layer-1 census)", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");
    const { distributeVotesByGroupLevelAllocation } = await import("./voteDistribution");
    const { distributeVotesBySwingFlow } = await import("./voteDistributionSwingFlow");

    const { electionId } = await setupForFlag({
      gameState: { _id: "current", granularElectorateEnabled: true },
    });
    await accumulateVoteTurn(electionId, 1, new Date());

    const call =
      vi.mocked(distributeVotesBySwingFlow).mock.calls[0] ??
      vi.mocked(distributeVotesByGroupLevelAllocation).mock.calls[0];
    expect(call).toBeDefined();
    const [, , , , demographics, categories] = call;
    expect(categories).toHaveLength(1);
    expect(categories[0]._id).toBe("granularCells");
    expect(categories[0].groups.length).toBeGreaterThan(5);
    expect(demographics.categoryWeights.granularCells).toBe(100);
    const popSum = Object.values(demographics.groups).reduce(
      (s: number, g) => s + (g as { population: number }).population,
      0
    );
    expect(popSum).toBeCloseTo(100, 3);
  });

  it("a state with no Layer-1 census passes its fixtures through untouched", async () => {
    const { accumulateVoteTurn } = await import("./tallyManagement");
    const { distributeVotesByGroupLevelAllocation } = await import("./voteDistribution");
    const { distributeVotesBySwingFlow } = await import("./voteDistributionSwingFlow");

    // The substrate keys on `election.state`, and PA has a real Layer-1 census —
    // which is why this can no longer lean on an absent flag. `ZZ` has none, so
    // buildGranularElectorateSubstrate returns null and the fixtures survive.
    const { electionId } = await setupForFlag({
      gameState: { _id: "current" },
      state: "ZZ",
    });
    await accumulateVoteTurn(electionId, 1, new Date());

    const call =
      vi.mocked(distributeVotesBySwingFlow).mock.calls[0] ??
      vi.mocked(distributeVotesByGroupLevelAllocation).mock.calls[0];
    expect(call).toBeDefined();
    const [, , totalPool, , demographics, categories] = call;
    // The exact fixture objects pass through — no substitution.
    expect(categories).toHaveLength(1);
    expect(categories[0]._id).toBe("ideology");
    expect(Object.keys(demographics.groups).sort()).toEqual(["conservative", "liberal"]);
    expect(totalPool).toBe(600_000);
  });
});
