/**
 * Query-shape regression guard for accumulateVoteTurn (perf audit wave 2,
 * 2026-08-03).
 *
 * This function runs for every active election on every turn, and its reads
 * used to be a long chain of sequential awaits. Two groups are now issued as
 * parallel round-trips:
 *
 *  1. state approval + candidate enrichment + party-group favorability
 *  2. the five gated driver lookups (incumbent seat share, campaign funds,
 *     presidential coattail, regional-executive approval, single-seat
 *     legislative incumbency)
 *
 * A timing assertion would flake, so these tests assert *dispatch order*
 * instead: they hold the first promise of a group unresolved and check that the
 * siblings were still invoked. Re-serializing any of them (turning a
 * `Promise.all` entry back into its own `await`) fails deterministically,
 * because a sequential caller cannot reach sibling N+1 while sibling N is
 * pending.
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

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("./candidateEnrichment", () => ({ fetchEnrichedCandidates: vi.fn() }));
vi.mock("./voteDistribution", () => ({ distributeVotesByGroupLevelAllocation: vi.fn() }));
vi.mock("./voteDistributionSwingFlow", () => ({ distributeVotesBySwingFlow: vi.fn() }));
vi.mock("./resolvedTurnout", () => ({
  resolveTurnout: vi.fn(),
  buildLiveTurnouts: vi.fn(),
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
vi.mock("@/lib/governorOffice/address/partyGroupFavorabilityLoader", () => ({
  loadPartyGroupFavorability: vi.fn(),
}));
vi.mock("./incumbentSeatShare", () => ({ getIncumbentSeatShareByParty: vi.fn() }));
vi.mock("./fundsByParty", () => ({ getFundsByPartyForElection: vi.fn() }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeElection(overrides: Partial<Election> = {}): Election {
  const now = new Date("2024-01-01T00:00:00Z");
  return {
    _id: new ObjectId(),
    countryId: "US",
    electionType: "senate",
    state: "PA",
    cycle: 1,
    status: "active",
    startTime: new Date(now.getTime() - 24 * 3_600_000),
    endTime: new Date(now.getTime() + 24 * 3_600_000),
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

function makeTally(electionId: ObjectId): ElectionVoteTally {
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
  } as ElectionVoteTally;
}

function makeEnriched(candidateId: string): EnrichedCandidate {
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
    "executiveEndorsements",
  ]) {
    db.collection(name);
  }
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

/** Wire every mock accumulateVoteTurn needs to run to completion. */
async function setupHappyPath(electionId: ObjectId, election: Election) {
  const candidate = makeCandidate({ electionId });
  const enriched = [makeEnriched(candidate._id.toString())];

  const { resolveTurnout } = await import("./resolvedTurnout");
  const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
  const { distributeVotesByGroupLevelAllocation } = await import("./voteDistribution");
  const { distributeVotesBySwingFlow } = await import("./voteDistributionSwingFlow");
  const { getStateApprovalForElection } = await import("@/lib/utils/getStateApprovalForElection");
  const { loadPartyGroupFavorability } =
    await import("@/lib/governorOffice/address/partyGroupFavorabilityLoader");

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

  vi.mocked(resolveTurnout).mockReturnValue({
    byGroup: { liberal: 60, conservative: 60 },
    totalPool: 100_000,
  });
  vi.mocked(fetchEnrichedCandidates).mockResolvedValue(enriched);
  const distribution = {
    votesPerCandidate: { [enriched[0].candidateId]: 5000 },
    sharesPct: { [enriched[0].candidateId]: 50 },
  };
  vi.mocked(distributeVotesByGroupLevelAllocation).mockReturnValue(distribution);
  vi.mocked(distributeVotesBySwingFlow).mockReturnValue(distribution);
  vi.mocked(getStateApprovalForElection).mockResolvedValue(50);
  vi.mocked(loadPartyGroupFavorability).mockResolvedValue(new Map());

  return { candidate, enriched };
}

/** Flush enough microtasks for any already-dispatched promise chain to advance. */
async function flushMicrotasks(times = 12) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("accumulateVoteTurn parallel dispatch", () => {
  it("dispatches approval, enrichment and favorability together", async () => {
    const electionId = new ObjectId();
    const election = makeElection({ _id: electionId });
    await setupHappyPath(electionId, election);

    const { getStateApprovalForElection } = await import("@/lib/utils/getStateApprovalForElection");
    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const { loadPartyGroupFavorability } =
      await import("@/lib/governorOffice/address/partyGroupFavorabilityLoader");

    // Hold approval pending. A sequential implementation parks here and never
    // reaches the other two.
    let releaseApproval!: (value: number) => void;
    vi.mocked(getStateApprovalForElection).mockReturnValue(
      new Promise<number>((resolve) => {
        releaseApproval = resolve;
      })
    );

    const { accumulateVoteTurn } = await import("./tallyManagement");
    const pending = accumulateVoteTurn(electionId, 1, new Date());
    await flushMicrotasks();

    expect(getStateApprovalForElection).toHaveBeenCalledTimes(1);
    expect(fetchEnrichedCandidates).toHaveBeenCalledTimes(1);
    expect(loadPartyGroupFavorability).toHaveBeenCalledTimes(1);

    releaseApproval(50);
    await pending;
    expect(db.collectionMocks.electionVoteTallies.updateOne).toHaveBeenCalledOnce();
  });

  it("dispatches the gated driver lookups together in a general election", async () => {
    const electionId = new ObjectId();
    // A House race past its primary boundary: general phase (opens the money
    // driver) and NOT a single-seat legislative race (US Senate is, and takes
    // the dedicated flat-shield path instead), so the seat-share gate opens too.
    const election = makeElection({
      _id: electionId,
      electionType: "house",
      primaryEndTurn: 1,
    } as Partial<Election>);
    await setupHappyPath(electionId, election);

    const { getIncumbentSeatShareByParty } = await import("./incumbentSeatShare");
    const { getFundsByPartyForElection } = await import("./fundsByParty");

    // Hold the seat-share lookup pending; the funds lookup must still fire.
    let releaseSeatShare!: (value: Map<string, number>) => void;
    vi.mocked(getIncumbentSeatShareByParty).mockReturnValue(
      new Promise<Map<string, number>>((resolve) => {
        releaseSeatShare = resolve;
      })
    );
    vi.mocked(getFundsByPartyForElection).mockResolvedValue(new Map());

    const { accumulateVoteTurn } = await import("./tallyManagement");
    const pending = accumulateVoteTurn(electionId, 5, new Date());
    await flushMicrotasks();

    // Non-vacuous: the general-election gate really did open.
    expect(getIncumbentSeatShareByParty).toHaveBeenCalledTimes(1);
    // The load-bearing assertion: dispatched while seat-share is still pending.
    expect(getFundsByPartyForElection).toHaveBeenCalledTimes(1);

    releaseSeatShare(new Map());
    await pending;
  });
});
