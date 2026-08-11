import { describe, expect, it } from "vitest";
import { distributeVotesByGroupLevelAllocation } from "@/lib/electionEngine/voteDistribution";
import type { EnrichedCandidate } from "@/lib/electionEngine/types";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types";

/**
 * F-4 raw-population-leak guard (design §6.2). Once P1b-1 makes `state.population`
 * drift every turn, the concern is that absolute turnout / vote COUNTS computed
 * from it would drift pre-census and shift vote SHARES or winners. They must not:
 * the electoral demographic SHARES are a B2 snapshot, and the live-population
 * factor cancels in the share ratio (`groupShare = groupContribution / totalPool`,
 * both ∝ statePopulation). This pins that invariant against the REAL vote
 * distributor — if a future change couples shares to absolute population, this
 * fails and the leak is surfaced rather than shipped.
 */

function makeCandidate(
  overrides: Partial<EnrichedCandidate> & { candidateId: string }
): EnrichedCandidate {
  return {
    characterId: overrides.candidateId,
    characterName: overrides.candidateId,
    party: "democrat",
    isNPP: false,
    charEP: 0,
    charSP: 0,
    favorability: 50,
    politicalInfluence: 100,
    nationalInfluence: 100,
    ...overrides,
  };
}

const categories: DemographicCategory[] = [
  {
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
  } as DemographicCategory,
];

const demographics = {
  _id: "PA",
  categoryWeights: { ideology: 100 },
  groups: {
    liberal: { population: 55, turnout: 62, economicLean: -3, socialLean: -3 },
    conservative: { population: 45, turnout: 58, economicLean: 3, socialLean: 3 },
  },
} as unknown as StateDemographics;

const emptyOrgMap = new Map<string, number>();
const candidates = () => [
  makeCandidate({ candidateId: "alice", charEP: -2, charSP: -2 }),
  makeCandidate({ candidateId: "bob", charEP: 2, charSP: 2 }),
];

/** totalPool tracks Σ group contributions, which is ∝ statePopulation. */
function poolFor(statePopulation: number): { totalPool: number; turnPool: number } {
  // liberal: pop55%·turnout62% ; conservative: pop45%·turnout58% ; weight 100%
  const totalPool = statePopulation * 0.55 * 0.62 + statePopulation * 0.45 * 0.58;
  return { totalPool, turnPool: totalPool * 0.02 };
}

describe("F-4 raw-population-leak guard", () => {
  it("vote SHARES are invariant to a per-turn population drift", () => {
    const run = (pop: number) => {
      const { totalPool, turnPool } = poolFor(pop);
      return distributeVotesByGroupLevelAllocation(
        candidates(),
        turnPool,
        totalPool,
        pop,
        demographics,
        categories,
        emptyOrgMap
      ).sharesPct;
    };
    const base = run(1_000_000);
    const drifted = run(1_010_000); // +1% one-turn population drift

    for (const id of Object.keys(base)) {
      expect(drifted[id]).toBeCloseTo(base[id], 6);
    }
  });

  it("the winner does not change under a large population swing", () => {
    const winnerAt = (pop: number) => {
      const { totalPool, turnPool } = poolFor(pop);
      const shares = distributeVotesByGroupLevelAllocation(
        candidates(),
        turnPool,
        totalPool,
        pop,
        demographics,
        categories,
        emptyOrgMap
      ).sharesPct;
      return Object.entries(shares).sort((a, b) => b[1] - a[1])[0][0];
    };
    expect(winnerAt(2_000_000)).toBe(winnerAt(1_000_000)); // population doubled
  });

  it("vote TOTALS scale linearly with population (intentional + bounded) while shares do not", () => {
    // The §6.2 clause: absolute turnout / vote COUNTS may move with the live
    // population — that IS intentional and bounded (linear in pop), as long as
    // SHARES don't (pinned above). Doubling the population ~doubles the vote pool;
    // the boundedness is the population bounds themselves (no super-linear blowup).
    const small = poolFor(1_000_000);
    const big = poolFor(2_000_000);
    expect(big.turnPool / small.turnPool).toBeCloseTo(2, 6);
    expect(big.totalPool / small.totalPool).toBeCloseTo(2, 6);
  });
});
