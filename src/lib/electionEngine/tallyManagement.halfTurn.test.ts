/**
 * Half-hour split turns on every ballot engine accumulateVoteTurn drives.
 *
 * Each case runs the real engine against a stateful in-memory store twice from
 * the same starting tally: once as one whole turn, once as an early half (the
 * :30 results tick) followed by the turn's rest. The distributor is mocked as a
 * pure share split of the pool it is handed, so any gap between the two runs
 * comes from the engine's own per-slice math. Each half must land, the two
 * halves must add up to the whole turn (to integer rounding), and repeats must
 * change nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Election, ElectionCandidate, ElectionVoteTally } from "@/lib/db/types";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  REAL_MONGO_ENABLED,
  startIsolatedMongod,
  stopIsolatedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import { validateRankedBallots } from "@/lib/turn/election/rules/prStv";
import type { EnrichedCandidate } from "./types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("./candidateEnrichment", () => ({ fetchEnrichedCandidates: vi.fn() }));
vi.mock("@/lib/utils/getStateApprovalForElection", () => ({
  getStateApprovalForElection: vi.fn().mockResolvedValue(50),
}));
vi.mock("./resolvedTurnout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./resolvedTurnout")>()),
  resolveTurnout: vi.fn(() => ({ byGroup: { liberal: 60, conservative: 60 }, totalPool: 100_000 })),
}));
// A pure share split of the pool: halving the pool halves every candidate.
const SHARES = [0.41, 0.27, 0.19, 0.13];
function splitPool(enriched: EnrichedCandidate[], pool: number) {
  const votesPerCandidate = Object.fromEntries(
    enriched.map((c, i) => [c.candidateId, pool * (SHARES[i] ?? 0.05)])
  );
  const sharesPct = Object.fromEntries(enriched.map((c, i) => [c.candidateId, SHARES[i] * 100]));
  return { votesPerCandidate, sharesPct };
}
vi.mock("./voteDistributionSwingFlow", () => ({
  distributeVotesBySwingFlow: vi.fn((e: EnrichedCandidate[], pool: number) => splitPool(e, pool)),
}));
vi.mock("./voteDistribution", () => ({
  distributeVotesByGroupLevelAllocation: vi.fn((e: EnrichedCandidate[], pool: number) =>
    splitPool(e, pool)
  ),
}));

const TURN = 110;
const START = new Date("2024-01-01T00:00:00Z");
const NOW = new Date(START.getTime() + 20 * 3_600_000);

interface Case {
  name: string;
  election: Partial<Election>;
  /** Filing fields, plus the enriched policy position of each candidate. */
  candidates: (Partial<ElectionCandidate> & { charEP?: number; charSP?: number })[];
  tally?: Partial<ElectionVoteTally>;
  preset?: string;
  /** Map fields compared between the whole and split runs. */
  maps: (keyof ElectionVoteTally)[];
}

const position = (i: number) => ({ charEP: i - 1.5, charSP: 1.5 - i });

const CASES: Case[] = [
  {
    name: "Irish PR-STV ranked ballots",
    election: { countryId: "IE", electionType: "dail", state: "DUB", totalSeats: 3 },
    candidates: ["1", "1", "2", "3"].map((p, i) => ({ party: p, isNPP: i > 1, ...position(i) })),
    tally: { countingMethod: "pr_stv", rankedBallots: [] },
    maps: ["totalVotes"],
  },
  {
    name: "Japan mixed-member Shugiin",
    election: {
      countryId: "JP",
      electionType: "shugiin",
      state: "HOK",
      totalSeats: 8,
      japanShugiinRules: { ruleVersion: "mixed-1994-v1" } as Election["japanShugiinRules"],
    },
    candidates: [
      { party: "ldp", constituencyId: "JP-HOK-01-01" },
      { party: "ldp", isNPP: true },
      { party: "jsp", isNPP: true },
      { party: "jcp", isNPP: true },
    ],
    preset: "1991-default",
    maps: ["totalVotes", "japanShugiinConstituencyVotes", "japanShugiinListVotes"],
  },
  {
    name: "Hungarian mixed assembly",
    election: {
      countryId: "HU",
      electionType: "nationalAssembly",
      state: "HU_PES",
      totalSeats: 10,
      hungarianModernAssembly: {
        ruleVersion: "mixed-2011-v1",
        registeredVoters: 900_000,
      } as unknown as Election["hungarianModernAssembly"],
    },
    candidates: [
      { party: "fidesz", constituencyId: "HU_PES:1" },
      { party: "fidesz", isNPP: true },
      { party: "mszp", isNPP: true },
      { party: "jobbik", isNPP: true },
    ],
    preset: "1991-default",
    maps: ["totalVotes", "huConstituencyVotes", "huListVotes"],
  },
  {
    name: "Bulgarian founding assembly",
    election: {
      countryId: "BG",
      electionType: "nationalAssembly",
      state: "BG_SOF",
      totalSeats: 4,
      bulgarianFoundingRound: {
        ruleVersion: "parallel-1990-v1",
        registeredVoters: 900_000,
      } as unknown as Election["bulgarianFoundingRound"],
    },
    candidates: ["bsp", "sds", "bzns", "dps"].map((p) => ({ party: p })),
    maps: ["totalVotes"],
  },
  {
    name: "Bulgarian ordinary assembly",
    election: { countryId: "BG", electionType: "nationalAssembly", state: "BG_SOF", totalSeats: 4 },
    candidates: ["bsp", "sds", "bzns", "dps"].map((p) => ({ party: p })),
    preset: "1991-default",
    maps: ["totalVotes"],
  },
  {
    name: "Russian Duma deputy",
    election: {
      countryId: "RU",
      electionType: "dumaDeputy",
      state: "MOW",
      russianDumaRound: { registeredVoters: 900_000 } as unknown as Election["russianDumaRound"],
    },
    candidates: ["1", "2", "3", "4"].map((p) => ({ party: p })),
    maps: ["totalVotes"],
  },
  {
    name: "Russian Federation Council",
    election: {
      countryId: "RU",
      electionType: "federationCouncilMember",
      state: "MOW",
      russianCouncilRound: {
        registeredVoters: 900_000,
      } as unknown as Election["russianCouncilRound"],
    },
    candidates: ["1", "2", "3", "4"].map((p, i) => ({
      party: p,
      ...position(i),
      russianCouncilNomination: {
        registrationOrder: i + 1,
      } as unknown as ElectionCandidate["russianCouncilNomination"],
    })),
    maps: ["totalVotes"],
  },
];

/** Both runs of a case share ids, so their count maps line up key by key. */
const idsByCase = new Map<Case, { electionId: ObjectId; people: [ObjectId, ObjectId][] }>();

async function seed(db: Db, c: Case) {
  if (!idsByCase.has(c))
    idsByCase.set(c, {
      electionId: new ObjectId(),
      people: c.candidates.map(() => [new ObjectId(), new ObjectId()]),
    });
  const ids = idsByCase.get(c)!;
  const electionId = ids.electionId;
  const election = {
    _id: electionId,
    cycle: 1,
    status: "active",
    startTurn: 90,
    primaryEndTurn: 100,
    endTurn: 148,
    startTime: new Date(START.getTime() - 10 * 3_600_000),
    primaryEndTime: START,
    endTime: new Date(START.getTime() + 48 * 3_600_000),
    createdAt: START,
    ...c.election,
  } as Election;
  const candidates = c.candidates.map(
    ({ charEP: _ep, charSP: _sp, ...row }, i) =>
      ({
        _id: ids.people[i][0],
        electionId,
        characterId: ids.people[i][1],
        characterName: `Candidate ${i}`,
        status: "active",
        isNPP: false,
        ...row,
      }) as ElectionCandidate
  );
  const enriched = candidates.map(
    (row, i) =>
      ({
        candidateId: row._id.toString(),
        characterId: row.characterId.toString(),
        characterName: row.characterName,
        party: row.party,
        isNPP: Boolean(row.isNPP),
        charEP: c.candidates[i].charEP ?? i,
        charSP: c.candidates[i].charSP ?? -i,
        favorability: 50 + i * 5,
        politicalInfluence: 100,
        nationalInfluence: 0,
      }) as EnrichedCandidate
  );
  const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
  vi.mocked(fetchEnrichedCandidates).mockResolvedValue(enriched);
  const state = election.state as string;
  const countryId = election.countryId;
  await db.collection("elections").insertOne(election as never);
  await db.collection("electionCandidates").insertMany(candidates as never[]);
  await db.collection("states").insertOne({
    _id: state,
    countryId,
    population: 1_000_000,
    votingSystem: "fptp",
  } as never);
  await db.collection("stateDemographics").insertOne({
    _id: state,
    countryId,
    categoryWeights: { ideology: 100 },
    groups: {
      liberal: { population: 50, turnout: 60, economicLean: -3, socialLean: -3 },
      conservative: { population: 50, turnout: 60, economicLean: 3, socialLean: 3 },
    },
  } as never);
  await db.collection("statePartyOrg").insertMany(
    [...new Set(candidates.map((row) => row.party))].map((partyId, i) => ({
      _id: `${state}_${partyId}`,
      stateId: state,
      countryId,
      partyId,
      organization: 30 + i * 7,
      registration: 25 - i * 3,
    })) as never[]
  );
  await db
    .collection("gameState")
    .insertOne({ _id: "current", currentTurn: TURN - 1, preset: c.preset } as never);
  await db.collection("electionVoteTallies").insertOne({
    _id: electionId,
    electionId,
    state,
    totalVotes: Object.fromEntries(enriched.map((row) => [row.candidateId, 0])),
    candidateNames: Object.fromEntries(enriched.map((row) => [row.candidateId, row.characterName])),
    candidateParties: Object.fromEntries(enriched.map((row) => [row.candidateId, row.party])),
    turnSnapshots: [{ turn: TURN - 1, recordedAt: START, cumulativeVotes: {}, sharesPct: {} }],
    finalized: false,
    createdAt: START,
    updatedAt: START,
    ...c.tally,
  } as never);
  return electionId;
}

/** Numeric leaves of a nested count map, keyed by path. */
function leaves(value: unknown, prefix = ""): Map<string, number> {
  const out = new Map<string, number>();
  if (typeof value === "number") out.set(prefix, value);
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value))
      for (const [path, n] of leaves(child, `${prefix}/${key}`)) out.set(path, n);
  return out;
}

function maxGap(a: unknown, b: unknown): number {
  const left = leaves(a);
  const right = leaves(b);
  let gap = 0;
  for (const key of new Set([...left.keys(), ...right.keys()]))
    gap = Math.max(gap, Math.abs((left.get(key) ?? 0) - (right.get(key) ?? 0)));
  return gap;
}

const sum = (votes: Record<string, number>) => Object.values(votes).reduce((a, b) => a + b, 0);

function runCases(newDb: () => Promise<Db>) {
  it.each(CASES)("$name: early plus rest is one whole turn", async (c) => {
    const { getDb } = await import("@/lib/mongodb");
    const { accumulateVoteTurn } = await import("./tallyManagement");
    const tallyOf = async (db: Db, id: ObjectId) =>
      (await db
        .collection<ElectionVoteTally>("electionVoteTallies")
        .findOne({ electionId: id })) as ElectionVoteTally;

    const wholeDb = await newDb();
    const wholeId = await seed(wholeDb, c);
    vi.mocked(getDb).mockResolvedValue(wholeDb as never);
    await accumulateVoteTurn(wholeId, TURN, NOW);
    const whole = await tallyOf(wholeDb, wholeId);
    expect(sum(whole.totalVotes)).toBeGreaterThan(1_000);

    const splitDb = await newDb();
    const splitId = await seed(splitDb, c);
    vi.mocked(getDb).mockResolvedValue(splitDb as never);
    await accumulateVoteTurn(splitId, TURN, NOW, { slice: "early" });
    const early = await tallyOf(splitDb, splitId);
    expect(early.turnSnapshots.at(-1)).toMatchObject({ turn: TURN, slicePart: "early" });
    expect(sum(early.totalVotes)).toBeGreaterThan(sum(whole.totalVotes) * 0.49);
    expect(sum(early.totalVotes)).toBeLessThan(sum(whole.totalVotes) * 0.51);
    await accumulateVoteTurn(splitId, TURN, NOW);
    const split = await tallyOf(splitDb, splitId);
    expect(split.turnSnapshots.map((s) => [s.turn, s.slicePart])).toEqual([
      [TURN - 1, undefined],
      [TURN, "early"],
      [TURN, "rest"],
    ]);

    // Integer ballots: each half rounds on its own, so a count may differ by
    // a ballot or two per cell. Nothing larger is allowed.
    for (const field of c.maps) {
      expect(whole[field], String(field)).toBeDefined();
      expect(maxGap(split[field], whole[field]), String(field)).toBeLessThanOrEqual(2);
    }
    expect(Math.abs(sum(split.totalVotes) - sum(whole.totalVotes))).toBeLessThanOrEqual(
      Object.keys(whole.totalVotes).length * 2
    );
    if (c.tally?.countingMethod === "pr_stv") {
      validateRankedBallots(split.rankedBallots, split.totalVotes);
      expect(sum(Object.fromEntries(split.rankedBallots!.map((b, i) => [i, b.weight])))).toBe(
        sum(split.totalVotes)
      );
    }
    if (c.election.russianCouncilRound) {
      expect(
        Math.abs(
          split.russianCouncilBallot!.validBallots - whole.russianCouncilBallot!.validBallots
        )
      ).toBeLessThanOrEqual(Object.keys(whole.totalVotes).length * 2);
    }

    // Repeats count nothing: a second early, and the turn again, on the split
    // run; an early tick and the turn again on the whole run.
    const strip = (t: ElectionVoteTally) => ({ ...t, updatedAt: undefined });
    await accumulateVoteTurn(splitId, TURN, NOW, { slice: "early" });
    await accumulateVoteTurn(splitId, TURN, NOW);
    expect(strip(await tallyOf(splitDb, splitId))).toEqual(strip(split));
    vi.mocked(getDb).mockResolvedValue(wholeDb as never);
    await accumulateVoteTurn(wholeId, TURN, NOW, { slice: "early" });
    await accumulateVoteTurn(wholeId, TURN, NOW);
    expect(strip(await tallyOf(wholeDb, wholeId))).toEqual(strip(whole));
  });
}

// Load the engine graph up front so a cold import cannot time out mid-case.
beforeAll(async () => {
  await import("./tallyManagement");
}, 120_000);

describe("half-hour split turns per ballot engine (in-memory store)", () => {
  beforeEach(() => vi.clearAllMocks());
  runCases(async () => createInMemoryDb() as unknown as Db);
});

describe.runIf(REAL_MONGO_ENABLED)("half-hour split turns per ballot engine (mongod)", () => {
  let fixture: IsolatedMongod | null = null;
  beforeAll(async () => {
    fixture = await startIsolatedMongod("ahd-half-turn-");
  }, 120_000);
  afterAll(async () => {
    await stopIsolatedMongod(fixture);
    fixture = null;
  }, 120_000);
  runCases(async () => fixture!.client.db(`ahd_half_turn_${new ObjectId().toHexString()}`));

  it("refuses a ranked rest write once the turn already holds a rest", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { accumulateVoteTurn } = await import("./tallyManagement");
    const db = fixture!.client.db(`ahd_half_turn_${new ObjectId().toHexString()}`);
    const id = await seed(db, CASES[0]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    await accumulateVoteTurn(id, TURN, NOW, { slice: "early" });
    const stale = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .findOne({ electionId: id });
    await accumulateVoteTurn(id, TURN, NOW);
    // A concurrent rest computed from the pre-rest tally must not land.
    await expect(accumulateVoteTurn(id, TURN, NOW, { tally: stale! })).rejects.toThrow(
      "lost its tally revision"
    );
  });
});
