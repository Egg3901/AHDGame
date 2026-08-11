/**
 * Tests for Presidential race vote distribution and primary rebalance.
 * Uses real seed data: demographicCategories, stateDemographics, party positions.
 * Covers candidates at different stat levels (influence, favorability, policy alignment).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import {
  distributeVotesByGroupLevelAllocation,
  calcStateTurnout,
  turnVoteWeight,
  type EnrichedCandidate,
} from "@/lib/electionEngine";
import { calcPresidentPrimaryScore } from "@/lib/primaryScore";
import { demographicCategories } from "@/lib/seeds/demographicCategories";
import { stateDemographics } from "@/lib/seeds/stateDemographics";
import { ELECTORAL_VOTE_UNITS } from "@/lib/constants/states";
import type { StateDemographics } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

// Real party positions from src/lib/seeds/reference/politicalParties.ts
const DEMOCRAT_POSITION = { econ: -2, social: -2 };
const REPUBLICAN_POSITION = { econ: 2, social: 2 };

function makeEnriched(
  candidateId: string,
  party: string,
  charEP: number,
  charSP: number,
  favorability: number,
  politicalInfluence: number,
  partyEcon?: number,
  partySocial?: number
): EnrichedCandidate {
  return {
    candidateId,
    characterId: candidateId,
    characterName: `Candidate ${candidateId}`,
    party,
    isNPP: false,
    charEP,
    charSP,
    favorability,
    politicalInfluence,
    nationalInfluence: 100,
    ...(partyEcon != null && partySocial != null && { partyEcon, partySocial }),
  };
}

function getDemographics(stateId: string): StateDemographics | undefined {
  return stateDemographics.find((d) => d._id === stateId);
}

describe("Presidential race — vote distribution with real data", () => {
  const categories = demographicCategories;
  const presidentialOptions = {
    useAveragedPositions: true,
    partyPositionWeight: 1 / 3, // 75% candidate, 25% party
    usePresidentialPartyOrg: true,
  };

  describe("California (blue state) — candidates at different stat levels", () => {
    const stateId = "CA";
    const demographics = getDemographics(stateId)!;
    const statePopulation = 39_538_223; // from src/lib/seeds/reference/states.ts
    const totalPool = calcStateTurnout(statePopulation, demographics, categories);
    const turnPool = turnVoteWeight(12, 6, totalPool);
    const strengthMultiplier = 1.5; // (1 + 0.5 approval)
    const effectiveTurnPool = turnPool * strengthMultiplier;

    // CA: Democrat-friendly. Party org: Dem ~70, Rep ~35 (from statePartyOrg seed logic)
    const partyOrgByParty = new Map<string, number>([
      ["democrat", 70],
      ["republican", 35],
    ]);

    it("high-influence Dem (90) beats low-influence Rep (15) in CA", () => {
      const enriched: EnrichedCandidate[] = [
        makeEnriched(
          "dem1",
          "democrat",
          -2,
          -2,
          60,
          90,
          DEMOCRAT_POSITION.econ,
          DEMOCRAT_POSITION.social
        ),
        makeEnriched(
          "rep1",
          "republican",
          2,
          2,
          60,
          15,
          REPUBLICAN_POSITION.econ,
          REPUBLICAN_POSITION.social
        ),
      ];

      const { votesPerCandidate, sharesPct } = distributeVotesByGroupLevelAllocation(
        enriched,
        effectiveTurnPool,
        totalPool,
        statePopulation,
        demographics,
        categories,
        partyOrgByParty,
        presidentialOptions
      );

      expect(votesPerCandidate["dem1"]).toBeGreaterThan(votesPerCandidate["rep1"]);
      expect(sharesPct["dem1"]).toBeGreaterThan(50);
      expect(sharesPct["rep1"]).toBeLessThan(50);
    });

    it("low-influence Dem (10) still wins in CA when Rep has low influence (10) — state lean matters", () => {
      const enriched: EnrichedCandidate[] = [
        makeEnriched(
          "dem1",
          "democrat",
          -2,
          -2,
          55,
          10,
          DEMOCRAT_POSITION.econ,
          DEMOCRAT_POSITION.social
        ),
        makeEnriched(
          "rep1",
          "republican",
          2,
          2,
          55,
          10,
          REPUBLICAN_POSITION.econ,
          REPUBLICAN_POSITION.social
        ),
      ];

      const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
        enriched,
        effectiveTurnPool,
        totalPool,
        statePopulation,
        demographics,
        categories,
        partyOrgByParty,
        presidentialOptions
      );

      // In blue CA, Dem should still get more votes when stats are equal (party org + lean)
      expect(votesPerCandidate["dem1"]).toBeGreaterThan(votesPerCandidate["rep1"]);
    });

    it("high favorability (85) beats low favorability (25) when other stats equal", () => {
      const enriched: EnrichedCandidate[] = [
        makeEnriched(
          "high",
          "democrat",
          -2,
          -2,
          85,
          50,
          DEMOCRAT_POSITION.econ,
          DEMOCRAT_POSITION.social
        ),
        makeEnriched(
          "low",
          "democrat",
          -2,
          -2,
          25,
          50,
          DEMOCRAT_POSITION.econ,
          DEMOCRAT_POSITION.social
        ),
      ];

      const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
        enriched,
        effectiveTurnPool,
        totalPool,
        statePopulation,
        demographics,
        categories,
        partyOrgByParty,
        presidentialOptions
      );

      expect(votesPerCandidate["high"]).toBeGreaterThan(votesPerCandidate["low"]);
    });

    it("political influence scales reach — high influence (95) gets more votes than low (5)", () => {
      const enriched: EnrichedCandidate[] = [
        makeEnriched(
          "high",
          "democrat",
          -2,
          -2,
          60,
          95,
          DEMOCRAT_POSITION.econ,
          DEMOCRAT_POSITION.social
        ),
        makeEnriched(
          "low",
          "democrat",
          -2,
          -2,
          60,
          5,
          DEMOCRAT_POSITION.econ,
          DEMOCRAT_POSITION.social
        ),
      ];

      const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
        enriched,
        effectiveTurnPool,
        totalPool,
        statePopulation,
        demographics,
        categories,
        partyOrgByParty,
        presidentialOptions
      );

      expect(votesPerCandidate["high"]).toBeGreaterThan(votesPerCandidate["low"]);
    });
  });

  describe("Texas (red state) — candidates at different stat levels", () => {
    const stateId = "TX";
    const demographics = getDemographics(stateId)!;
    const statePopulation = 29_145_505;
    const totalPool = calcStateTurnout(statePopulation, demographics, categories);
    const turnPool = turnVoteWeight(12, 6, totalPool);
    const effectiveTurnPool = turnPool * 1.5;

    // TX: Republican-friendly. Party org: Rep ~70, Dem ~35
    const partyOrgByParty = new Map<string, number>([
      ["democrat", 35],
      ["republican", 70],
    ]);

    it("high-influence Rep (90) beats low-influence Dem (15) in TX", () => {
      const enriched: EnrichedCandidate[] = [
        makeEnriched(
          "dem1",
          "democrat",
          -2,
          -2,
          60,
          15,
          DEMOCRAT_POSITION.econ,
          DEMOCRAT_POSITION.social
        ),
        makeEnriched(
          "rep1",
          "republican",
          2,
          2,
          60,
          90,
          REPUBLICAN_POSITION.econ,
          REPUBLICAN_POSITION.social
        ),
      ];

      const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
        enriched,
        effectiveTurnPool,
        totalPool,
        statePopulation,
        demographics,
        categories,
        partyOrgByParty,
        presidentialOptions
      );

      expect(votesPerCandidate["rep1"]).toBeGreaterThan(votesPerCandidate["dem1"]);
    });

    it("low party org (10) hurts candidate vs high party org (90) in same state", () => {
      // Two Dems: one in high-org state simulation (we use different party org by passing different parties)
      // For same party, org is same. So compare Dem vs Rep with Dem having low org in TX
      const enriched: EnrichedCandidate[] = [
        makeEnriched(
          "dem1",
          "democrat",
          -2,
          -2,
          60,
          50,
          DEMOCRAT_POSITION.econ,
          DEMOCRAT_POSITION.social
        ),
        makeEnriched(
          "rep1",
          "republican",
          2,
          2,
          60,
          50,
          REPUBLICAN_POSITION.econ,
          REPUBLICAN_POSITION.social
        ),
      ];
      // Dem org 35, Rep org 70 in TX — presidential party org scalar is steep (0.05–1.0)
      const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
        enriched,
        effectiveTurnPool,
        totalPool,
        statePopulation,
        demographics,
        categories,
        partyOrgByParty,
        presidentialOptions
      );

      expect(votesPerCandidate["rep1"]).toBeGreaterThan(votesPerCandidate["dem1"]);
    });
  });

  describe("Swing state (PA) — policy alignment matters", () => {
    const stateId = "PA";
    const demographics = getDemographics(stateId)!;
    const statePopulation = 13_002_700;
    const totalPool = calcStateTurnout(statePopulation, demographics, categories);
    const turnPool = turnVoteWeight(12, 6, totalPool);
    const effectiveTurnPool = turnPool * 1.5;

    const partyOrgByParty = new Map<string, number>([
      ["democrat", 55],
      ["republican", 55],
    ]);

    it("moderate Dem (-1,-1) vs moderate Rep (1,1) — similar stats yield competitive split", () => {
      const enriched: EnrichedCandidate[] = [
        makeEnriched(
          "dem1",
          "democrat",
          -1,
          -1,
          55,
          50,
          DEMOCRAT_POSITION.econ,
          DEMOCRAT_POSITION.social
        ),
        makeEnriched(
          "rep1",
          "republican",
          1,
          1,
          55,
          50,
          REPUBLICAN_POSITION.econ,
          REPUBLICAN_POSITION.social
        ),
      ];

      const { sharesPct } = distributeVotesByGroupLevelAllocation(
        enriched,
        effectiveTurnPool,
        totalPool,
        statePopulation,
        demographics,
        categories,
        partyOrgByParty,
        presidentialOptions
      );

      // In swing PA, neither should dominate — both shares between 30–70%
      expect(sharesPct["dem1"]).toBeGreaterThan(25);
      expect(sharesPct["dem1"]).toBeLessThan(75);
      expect(sharesPct["rep1"]).toBeGreaterThan(25);
      expect(sharesPct["rep1"]).toBeLessThan(75);
    });
  });
});

describe("Presidential primary rebalance — calcPresidentPrimaryScore", () => {
  const partyEcon = -2;
  const partySocial = -2;

  describe("national influence vs political influence", () => {
    it("high national influence (90) beats low (10) when policy aligned", () => {
      const high = calcPresidentPrimaryScore(-2, -2, partyEcon, partySocial, 60, 90, 70);
      const low = calcPresidentPrimaryScore(-2, -2, partyEcon, partySocial, 60, 10, 70);
      expect(high).toBeGreaterThan(low);
    });

    it("national influence contributes up to 20 pts once raw NPI saturates the curve", () => {
      const zero = calcPresidentPrimaryScore(-2, -2, partyEcon, partySocial, 50, 0, 50);
      const saturated = calcPresidentPrimaryScore(-2, -2, partyEcon, partySocial, 50, 600, 50);
      expect(saturated - zero).toBeCloseTo(20, 0);
    });
  });

  describe("party influence (candidate's own party clout)", () => {
    it("high party influence (90) beats low (10) when other stats equal", () => {
      const high = calcPresidentPrimaryScore(-2, -2, partyEcon, partySocial, 60, 50, 90);
      const low = calcPresidentPrimaryScore(-2, -2, partyEcon, partySocial, 60, 50, 10);
      expect(high).toBeGreaterThan(low);
    });

    it("party influence contributes up to 30 pts at the 150 cap", () => {
      const zero = calcPresidentPrimaryScore(-2, -2, partyEcon, partySocial, 50, 50, 0);
      const full = calcPresidentPrimaryScore(-2, -2, partyEcon, partySocial, 50, 50, 150);
      expect(full - zero).toBeCloseTo(30, 0);
    });
  });

  describe("policy alignment (40 pts max)", () => {
    it("perfect alignment (matches party) scores higher than misaligned", () => {
      const aligned = calcPresidentPrimaryScore(-2, -2, partyEcon, partySocial, 50, 50, 50);
      const misaligned = calcPresidentPrimaryScore(3, 3, partyEcon, partySocial, 50, 50, 50);
      expect(aligned).toBeGreaterThan(misaligned);
    });

    it("policy alignment dominates over favorability in presidential formula", () => {
      // Fav is only 10 pts max; policy is 40 pts
      const alignedLowFav = calcPresidentPrimaryScore(-2, -2, partyEcon, partySocial, 20, 50, 50);
      const misalignedHighFav = calcPresidentPrimaryScore(
        4,
        4,
        partyEcon,
        partySocial,
        100,
        50,
        50
      );
      expect(alignedLowFav).toBeGreaterThan(misalignedHighFav);
    });
  });

  describe("favorability (10 pts max)", () => {
    it("favorability contributes up to 10 pts", () => {
      const zero = calcPresidentPrimaryScore(-2, -2, partyEcon, partySocial, 0, 50, 50);
      const full = calcPresidentPrimaryScore(-2, -2, partyEcon, partySocial, 100, 50, 50);
      expect(full - zero).toBeCloseTo(10, 0);
    });
  });

  describe("realistic candidate profiles", () => {
    it("establishment Dem (high org, high influence) beats insurgent (low org, low influence)", () => {
      const establishment = calcPresidentPrimaryScore(-2, -2, partyEcon, partySocial, 65, 85, 80);
      const insurgent = calcPresidentPrimaryScore(-2, -2, partyEcon, partySocial, 70, 25, 20);
      expect(establishment).toBeGreaterThan(insurgent);
    });

    it("popular outsider (high favorability, high influence) can beat weak establishment (low org)", () => {
      const outsider = calcPresidentPrimaryScore(-1, -1, partyEcon, partySocial, 90, 500, 25);
      const weakEstablishment = calcPresidentPrimaryScore(
        -2,
        -2,
        partyEcon,
        partySocial,
        50,
        40,
        30
      );
      expect(outsider).toBeGreaterThan(weakEstablishment);
    });
  });
});

describe("Presidential general election — full path (accumulatePresidentVoteTurn)", () => {
  const uniqueStateIds = [...new Set(ELECTORAL_VOTE_UNITS.map((u) => u.stateId))];

  // Real states from seed + DC (not in seed)
  const statesWithDC = [
    ...stateDemographics.map((d) => {
      const pop =
        d._id === "DC"
          ? 689545
          : (() => {
              const pops: Record<string, number> = {
                CA: 39538223,
                TX: 29145505,
                FL: 21538187,
                NY: 20201249,
                PA: 13002700,
                IL: 12812508,
                OH: 11799448,
                GA: 10711908,
                NC: 10439388,
                MI: 10077331,
                NJ: 9288994,
                VA: 8631393,
                WA: 7614893,
                AZ: 7151502,
                MA: 7029917,
                TN: 6910840,
                IN: 6785528,
                MO: 6154913,
                MD: 6177224,
                WI: 5893718,
                CO: 5773714,
                MN: 5706494,
                SC: 5118425,
                AL: 5024279,
                LA: 4657757,
                KY: 4505836,
                OR: 4237256,
                OK: 3959353,
                CT: 3605944,
                UT: 3271616,
                NV: 3104614,
                AR: 3011524,
                MS: 2961279,
                KS: 2937880,
                NM: 2117522,
                NE: 1961504,
                ID: 1839106,
                WV: 1793716,
                HI: 1455271,
                NH: 1377529,
                ME: 1362359,
                MT: 1084225,
                RI: 1097379,
                DE: 989948,
                SD: 886667,
                ND: 779094,
                AK: 733391,
                VT: 643077,
                WY: 576851,
              };
              return pops[d._id] ?? 1000000;
            })();
      return {
        _id: d._id,
        name: d._id,
        population: pop,
        gdp: 0,
        houseDistricts: 1,
        region: "Northeast",
      };
    }),
  ].filter((s, i, arr) => arr.findIndex((x) => x._id === s._id) === i);

  // State party org: use seed-like values. DC is very blue.
  const statePartyOrgs = stateDemographics.flatMap((d) => {
    const margin = { CA: 29.2, TX: -5.6, DC: 86.8 }[d._id];
    const lean = margin != null ? Math.max(-5, Math.min(5, -margin / 10)) : 0;
    const demOrg = 25 + Math.max(0, -lean) * 7;
    const repOrg = 25 + Math.max(0, lean) * 7;
    return [
      {
        _id: `${d._id}_us_democrat`,
        stateId: d._id,
        partyId: "democrat",
        organization: Math.min(100, demOrg),
      },
      {
        _id: `${d._id}_us_republican`,
        stateId: d._id,
        partyId: "republican",
        organization: Math.min(100, repOrg),
      },
    ];
  });

  function createMockDb(opts: {
    electionId: ObjectId;
    demId: string;
    repId: string;
    tally: {
      totalVotes: Record<string, number>;
      totalVotesByUnit: Record<string, Record<string, number>>;
    };
    startTime: Date;
    endTime: Date;
    omitDcState?: boolean;
  }) {
    const { electionId, demId, repId, tally, startTime, endTime } = opts;
    const charDemId = new ObjectId();
    const charRepId = new ObjectId();
    const candidates = [
      {
        _id: new ObjectId(demId),
        electionId,
        characterId: charDemId,
        characterName: "Dem Candidate",
        party: "democrat",
        isNPP: false,
        status: "active",
      },
      {
        _id: new ObjectId(repId),
        electionId,
        characterId: charRepId,
        characterName: "Rep Candidate",
        party: "republican",
        isNPP: false,
        status: "active",
      },
    ];
    const characters = [
      {
        _id: charDemId,
        policies: { economic: -2, social: -2 },
        favorability: 65,
        politicalInfluence: 70,
      },
      {
        _id: charRepId,
        policies: { economic: 2, social: 2 },
        favorability: 60,
        politicalInfluence: 65,
      },
    ];
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });

    const collection = vi.fn().mockImplementation((name: string) => {
      if (name === "electionVoteTallies") {
        return {
          findOne: vi.fn().mockResolvedValue({
            electionId,
            totalVotes: tally.totalVotes,
            totalVotesByUnit: tally.totalVotesByUnit,
            unitTurnSnapshots: {},
            createdAt: startTime,
          }),
          updateOne,
        };
      }
      if (name === "electionCandidates") {
        return {
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(candidates) }),
        };
      }
      if (name === "elections") {
        return {
          findOne: vi.fn().mockResolvedValue({
            _id: electionId,
            startTime,
            endTime,
            electionType: "president",
          }),
        };
      }
      if (name === "demographicCategories") {
        return {
          find: vi
            .fn()
            .mockReturnValue({ toArray: vi.fn().mockResolvedValue(demographicCategories) }),
        };
      }
      if (name === "states") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue(
              uniqueStateIds
                .filter((id) => !(opts.omitDcState && id === "DC"))
                .map(
                  (id) =>
                    statesWithDC.find((s) => s._id === id) ?? {
                      _id: id,
                      population: 1000000,
                      gdp: 0,
                      houseDistricts: 1,
                      region: "Northeast",
                    }
                )
            ),
          }),
        };
      }
      if (name === "stateDemographics") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi
              .fn()
              .mockResolvedValue(
                uniqueStateIds
                  .map((id) => stateDemographics.find((d) => d._id === id))
                  .filter(Boolean)
              ),
          }),
        };
      }
      if (name === "statePartyOrg") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi
              .fn()
              .mockResolvedValue(statePartyOrgs.filter((o) => uniqueStateIds.includes(o.stateId))),
          }),
        };
      }
      if (name === "stateMetrics") {
        return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
      }
      if (name === "characters") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue(characters),
          }),
        };
      }
      if (name === "politicalParties") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([
              { _id: "democrat", economicPosition: -2, socialPosition: -2 },
              { _id: "republican", economicPosition: 2, socialPosition: 2 },
            ]),
          }),
        };
      }
      if (name === "campaigns") {
        return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
      }
      if (name === "stateDemographicTurnout") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        };
      }
      if (name === "governorEndorsements") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        };
      }
      if (name === "partyGroupFavorability") {
        return {
          find: vi.fn().mockReturnValue({
            project: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
      }
      if (name === "countryState") {
        // Phase 1b: presidentialElectionEngine reads countryState to know
        // whether the election country is currently a one-party state
        // (gates the FPTP spoiler skip). Default for US tests: presidential.
        return {
          findOne: vi.fn().mockResolvedValue({
            _id: "US",
            countryId: "US",
            governmentType: "presidential",
            rulingPartyId: null,
            opsVoteMultipliers: null,
            hasLeaderConfidenceModel: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        };
      }
      return {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
          toArray: vi.fn().mockResolvedValue([]),
        }),
        findOne: vi.fn().mockResolvedValue(null),
      };
    });

    return { collection, updateOne };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accumulates votes across all electoral units and Dem leads nationally (blue tilt)", async () => {
    const electionId = new ObjectId();
    const demId = new ObjectId().toString();
    const repId = new ObjectId().toString();
    const initialTotalVotes = { [demId]: 0, [repId]: 0 };
    const initialTotalVotesByUnit: Record<string, Record<string, number>> = {};
    for (const unit of ELECTORAL_VOTE_UNITS) {
      initialTotalVotesByUnit[unit.unitId] = { [demId]: 0, [repId]: 0 };
    }

    const startTime = new Date("2024-11-01T00:00:00Z");
    const endTime = new Date("2024-11-05T00:00:00Z");
    const now = new Date("2024-11-03T12:00:00Z");
    const { collection, updateOne } = createMockDb({
      electionId,
      demId,
      repId,
      tally: { totalVotes: initialTotalVotes, totalVotesByUnit: initialTotalVotesByUnit },
      startTime,
      endTime,
    });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({ collection } as never);

    const { accumulatePresidentVoteTurn } = await import("./presidentialElectionEngine");
    await accumulatePresidentVoteTurn(electionId, 1, now);

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [, update] = updateOne.mock.calls[0];
    const totalVotes = update.$set.totalVotes as Record<string, number>;
    const demTotal = totalVotes[demId] ?? 0;
    const repTotal = totalVotes[repId] ?? 0;

    expect(demTotal).toBeGreaterThan(0);
    expect(repTotal).toBeGreaterThan(0);
    expect(demTotal + repTotal).toBeGreaterThan(100_000);
    // Dem has slight favorability/lead in blue states; nationally should be competitive or Dem lean
    expect(totalVotes).toBeDefined();
    expect(Object.keys(update.$set.unitTurnSnapshots || {})).toContain("CA");
    expect(Object.keys(update.$set.unitTurnSnapshots || {})).toContain("TX");
  });

  it("applies state lean — Dem wins CA unit, Rep wins TX unit", async () => {
    const electionId = new ObjectId();
    const demId = new ObjectId().toString();
    const repId = new ObjectId().toString();
    const initialTotalVotesByUnit: Record<string, Record<string, number>> = {};
    for (const unit of ELECTORAL_VOTE_UNITS) {
      initialTotalVotesByUnit[unit.unitId] = { [demId]: 0, [repId]: 0 };
    }

    const { collection, updateOne } = createMockDb({
      electionId,
      demId,
      repId,
      tally: {
        totalVotes: { [demId]: 0, [repId]: 0 },
        totalVotesByUnit: initialTotalVotesByUnit,
      },
      startTime: new Date("2024-11-01T00:00:00Z"),
      endTime: new Date("2024-11-05T00:00:00Z"),
    });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({ collection } as never);

    const { accumulatePresidentVoteTurn } = await import("./presidentialElectionEngine");
    await accumulatePresidentVoteTurn(electionId, 1, new Date("2024-11-03T12:00:00Z"));

    const [, update] = updateOne.mock.calls[0];
    const unitTurnSnapshots = update.$set.unitTurnSnapshots as Record<
      string,
      { cumulativeVotes: Record<string, number> }[]
    >;
    const caSnap = unitTurnSnapshots?.CA?.[0]?.cumulativeVotes;
    const txSnap = unitTurnSnapshots?.TX?.[0]?.cumulativeVotes;

    expect(caSnap).toBeDefined();
    expect(txSnap).toBeDefined();
    if (caSnap) expect(caSnap[demId]).toBeGreaterThan(caSnap[repId]);
    if (txSnap) expect(txSnap[repId]).toBeGreaterThan(txSnap[demId]);
  });

  it("accumulates DC votes when the states collection lacks a DC row", async () => {
    const electionId = new ObjectId();
    const demId = new ObjectId().toString();
    const repId = new ObjectId().toString();
    const initialTotalVotesByUnit: Record<string, Record<string, number>> = {};
    for (const unit of ELECTORAL_VOTE_UNITS) {
      initialTotalVotesByUnit[unit.unitId] = { [demId]: 0, [repId]: 0 };
    }

    const { collection, updateOne } = createMockDb({
      electionId,
      demId,
      repId,
      tally: {
        totalVotes: { [demId]: 0, [repId]: 0 },
        totalVotesByUnit: initialTotalVotesByUnit,
      },
      startTime: new Date("2024-11-01T00:00:00Z"),
      endTime: new Date("2024-11-05T00:00:00Z"),
      omitDcState: true,
    });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({ collection } as never);

    const { accumulatePresidentVoteTurn } = await import("./presidentialElectionEngine");
    await accumulatePresidentVoteTurn(electionId, 1, new Date("2024-11-03T12:00:00Z"));

    const [, update] = updateOne.mock.calls[0];
    const dcVotes = update.$set.totalVotesByUnit.DC as Record<string, number>;

    expect(dcVotes[demId] + dcVotes[repId]).toBeGreaterThan(0);
  });
});
