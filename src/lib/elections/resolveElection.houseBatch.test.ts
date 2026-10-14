import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { makeCandidate, makeCharacter, makeElection, makeParty } from "@/lib/test-utils/factories";
import { getGameTime } from "@/lib/time/gameTime";
import type { CountryId } from "@/lib/constants/countries";
import type { ElectionStatus } from "@/lib/db/types/election";
import { resolveElections } from "./resolveElection";

vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(() => {
    throw new Error("Unexpected ambient database access");
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGameTime).mockResolvedValue({
    currentTurn: 10,
    effectiveNow: new Date("2025-06-15T00:00:00Z"),
  } as never);
});

type TallyState = "unfinalized" | "finalized-empty" | "finalized-allocation" | "absent";

interface HouseElectionSeed {
  state: string;
  countryId?: CountryId;
  electionType?: string;
  status?: ElectionStatus;
  tally?: TallyState;
}

interface HouseBatchOptions {
  gameState?: Record<string, unknown> | null;
  districtsPresent?: boolean;
}

/** Seed a small real-enrichment batch so district eligibility and allocations are exercised end to end. */
function seededHouseBatch(specs: HouseElectionSeed[], options: HouseBatchOptions = {}) {
  const elections = specs.map((spec) =>
    makeElection({
      countryId: spec.countryId ?? "US",
      electionType: spec.electionType ?? "house",
      state: spec.state,
      status: spec.status ?? "active",
      totalSeats: 2,
    })
  );
  const candidatesByElection = new Map(
    elections.map((election) => [
      election._id.toString(),
      ["DEM", "GOP"].map((party) =>
        makeCandidate({
          electionId: election._id,
          party,
          characterId: new ObjectId(),
          status: "active",
        })
      ),
    ])
  );
  const candidates = [...candidatesByElection.values()].flat();
  const characters = candidates.map((candidate) =>
    makeCharacter({
      _id: candidate.characterId,
      countryId:
        elections.find((election) => election._id.equals(candidate.electionId))?.countryId ?? "US",
      party: candidate.party,
      homeState: elections.find((election) => election._id.equals(candidate.electionId))?.state,
    })
  );
  const countries = [...new Set(elections.map((election) => election.countryId ?? "US"))];
  const parties = countries.flatMap((countryId) => [
    makeParty({
      countryId,
      sequentialId: 1,
      abbreviation: "DEM",
      name: "Democrats",
      economicPosition: -50,
    }),
    makeParty({
      countryId,
      sequentialId: 2,
      abbreviation: "GOP",
      name: "Republicans",
      economicPosition: 50,
    }),
  ]);
  const tallies = elections.flatMap((election, index) => {
    const state = specs[index].tally ?? "unfinalized";
    if (state === "absent") return [];
    const electionCandidates = candidatesByElection.get(election._id.toString())!;
    const dem = electionCandidates.find((candidate) => candidate.party === "DEM")!;
    const gop = electionCandidates.find((candidate) => candidate.party === "GOP")!;
    return [
      {
        _id: new ObjectId(),
        electionId: election._id,
        state: election.state,
        totalVotes: { [dem._id.toString()]: 1000, [gop._id.toString()]: 400 },
        candidateNames: {},
        candidateParties: {},
        turnSnapshots: [],
        finalized: state.startsWith("finalized"),
        ...(state === "finalized-empty" ? { seatsEstimate: {} } : {}),
        ...(state === "finalized-allocation"
          ? { seatsEstimate: { [dem._id.toString()]: 2, [gop._id.toString()]: 0 } }
          : {}),
      },
    ];
  });
  const districtStates = [
    ...new Set(
      specs
        .filter(
          (spec) => (spec.countryId ?? "US") === "US" && (spec.electionType ?? "house") === "house"
        )
        .map((spec) => spec.state)
    ),
  ];
  const districts = districtStates.flatMap((state) => [
    {
      _id: `US_${state}_1`,
      countryId: "US",
      stateId: state,
      index: 1,
      squares: { left: 16, right: 0, grey: 0 },
      netLean: -16,
    },
    {
      _id: `US_${state}_2`,
      countryId: "US",
      stateId: state,
      index: 2,
      squares: { left: 0, right: 16, grey: 0 },
      netLean: 16,
    },
  ]);
  const db = createMockDb();
  const col = (name: string) => db.collection(name);
  col("electionCandidates").find.mockReturnValue({ toArray: async () => candidates });
  col("characters").find.mockImplementation((filter: any) => ({
    toArray: async () => (filter?.countryId ? [] : characters),
  }));
  col("politicalParties").find.mockReturnValue({ toArray: async () => parties });
  col("electionVoteTallies").find.mockReturnValue({ toArray: async () => tallies });
  col("gameState").findOne.mockResolvedValue(
    options.gameState === undefined
      ? {
          _id: "current",
          preset: "1990",
          currentYear: 1992,
          currentTurn: 10,
          isActive: true,
          redistrictingEnabled: true,
        }
      : options.gameState
  );
  col("congressionalDistricts").find.mockImplementation((filter: any) => ({
    toArray: async () =>
      (options.districtsPresent === false ? [] : districts).filter(
        (district) =>
          district.countryId === filter.countryId &&
          (district.stateId === filter.stateId || filter.stateId?.$in?.includes(district.stateId))
      ),
  }));
  col("states").find.mockReturnValue({ toArray: async () => [] });

  return {
    db,
    elections,
    candidatesByElection,
    districts,
    resolve: () =>
      resolveElections(db as unknown as Db, elections, { view: "summary", userId: null }),
  };
}

describe("batched US House district projections", () => {
  it("projects only unsettled eligible states through one scoped, deduplicated read", async () => {
    const fixture = seededHouseBatch([
      { state: "CA" },
      { state: "CA" },
      { state: "NY" },
      { state: "TX", tally: "finalized-allocation" },
      { state: "ON", countryId: "UK" },
      { state: "FL", electionType: "senate" },
    ]);

    const result = await fixture.resolve();
    for (const [index, election] of fixture.elections.entries()) {
      const race = result[index];
      const candidateIds = fixture.candidatesByElection.get(election._id.toString())!;
      const seats = race.seatsEstimate ?? {};
      expect(Object.values(seats).reduce((sum, count) => sum + count, 0)).toBe(2);
      if (index < 3) {
        expect(seats).toEqual(
          Object.fromEntries(candidateIds.map((candidate) => [candidate._id.toString(), 1]))
        );
      }
    }

    const districtReads = fixture.db.collection("congressionalDistricts").find.mock.calls;
    expect(districtReads).toHaveLength(1);
    expect(districtReads[0][0]).toEqual({ countryId: "US", stateId: { $in: ["CA", "NY"] } });
    expect(fixture.db.collection("politicalParties").find).toHaveBeenCalledTimes(1);
    expect(fixture.db.collection("congressionalDistricts").updateOne).not.toHaveBeenCalled();
    expect(fixture.db.collection("congressionalDistricts").updateMany).not.toHaveBeenCalled();
    expect(fixture.db.collection("congressionalDistricts").bulkWrite).not.toHaveBeenCalled();
  });

  it.each([
    {
      reason: "redistricting is disabled",
      spec: { state: "CA" },
      gameState: { _id: "current", preset: "1990", currentYear: 1992, redistrictingEnabled: false },
    },
    {
      reason: "the redistricting flag is missing",
      spec: { state: "CA" },
      gameState: { _id: "current", preset: "1990", currentYear: 1992 },
    },
    {
      reason: "the House tally is missing",
      spec: { state: "CA", tally: "absent" as const },
      gameState: { _id: "current", preset: "1990", currentYear: 1992, redistrictingEnabled: true },
    },
    {
      reason: "the House race is outside the US",
      spec: { state: "ON", countryId: "UK" as const },
      gameState: { _id: "current", preset: "1990", currentYear: 1992, redistrictingEnabled: true },
    },
    {
      reason: "the US race is not a House election",
      spec: { state: "FL", electionType: "senate" },
      gameState: { _id: "current", preset: "1990", currentYear: 1992, redistrictingEnabled: true },
    },
    {
      reason: "a finalized nonempty allocation already exists",
      spec: { state: "TX", tally: "finalized-allocation" as const },
      gameState: { _id: "current", preset: "1990", currentYear: 1992, redistrictingEnabled: true },
    },
  ])("does not read districts when $reason", async ({ spec, gameState }) => {
    const fixture = seededHouseBatch([spec], { gameState });

    await fixture.resolve();

    expect(fixture.db.collection("congressionalDistricts").find).not.toHaveBeenCalled();
  });

  it.each([
    {
      tally: "unfinalized" as const,
      status: "completed" as const,
      reason: "a completed but unfinalized election",
    },
    {
      tally: "finalized-empty" as const,
      status: "completed" as const,
      reason: "a finalized tally with an empty allocation",
    },
  ])(
    "projects districts for $reason and returns the expected seat allocation",
    async ({ tally, status }) => {
      const fixture = seededHouseBatch([{ state: "CA", status, tally }]);

      const [race] = await fixture.resolve();
      const candidates = fixture.candidatesByElection.get(fixture.elections[0]._id.toString())!;
      expect(race.seatsEstimate).toEqual(
        Object.fromEntries(candidates.map((candidate) => [candidate._id.toString(), 1]))
      );
      expect(Object.values(race.seatsEstimate ?? {}).reduce((sum, count) => sum + count, 0)).toBe(
        2
      );
      expect(fixture.db.collection("congressionalDistricts").find).toHaveBeenCalledTimes(1);
    }
  );

  it("falls back to the statewide allocation when the single district read is empty", async () => {
    const fixture = seededHouseBatch([{ state: "CA" }], { districtsPresent: false });

    const [race] = await fixture.resolve();
    const candidates = fixture.candidatesByElection.get(fixture.elections[0]._id.toString())!;
    expect(race.seatsEstimate).toEqual({
      [candidates[0]._id.toString()]: 1,
      [candidates[1]._id.toString()]: 1,
    });
    expect(Object.values(race.seatsEstimate ?? {}).reduce((sum, count) => sum + count, 0)).toBe(2);
    expect(fixture.db.collection("congressionalDistricts").find).toHaveBeenCalledTimes(1);
  });
});
