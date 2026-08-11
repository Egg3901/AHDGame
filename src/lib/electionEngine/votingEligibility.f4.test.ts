import { describe, expect, it } from "vitest";
import { distributeVotesByGroupLevelAllocation } from "./voteDistribution";
import type { EnrichedCandidate } from "./types";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types";

/**
 * Eligible-voter basis (P1b-1b): the election turnout pool now uses the live
 * voting-age population (Σ ages ≥ votingAgeEligible) instead of raw total
 * population. That shrinks the absolute pool, but vote SHARES must STILL be
 * invariant to the population BASIS (the F-4 guarantee) — the basis cancels in
 * `groupShare = groupContribution / totalPool`. This pins that the choice of
 * basis (total vs eligible) does not move shares or the winner, only magnitude.
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

/** totalPool tracks Σ group contributions, ∝ the basis population used. */
function poolFor(basisPopulation: number): { totalPool: number; turnPool: number } {
  const totalPool = basisPopulation * 0.55 * 0.62 + basisPopulation * 0.45 * 0.58;
  return { totalPool, turnPool: totalPool * 0.02 };
}

function sharesAt(basisPopulation: number): Record<string, number> {
  const { totalPool, turnPool } = poolFor(basisPopulation);
  return distributeVotesByGroupLevelAllocation(
    candidates(),
    turnPool,
    totalPool,
    basisPopulation,
    demographics,
    categories,
    emptyOrgMap
  ).sharesPct;
}

describe("eligible-voter basis keeps vote shares invariant (F-4 re-check)", () => {
  it("shares are identical whether the pool basis is total or voting-age population", () => {
    const total = sharesAt(1_000_000); // raw total population basis
    const eligible = sharesAt(760_000); // voting-age subset (e.g. 76% are 18+)
    for (const id of Object.keys(total)) {
      expect(eligible[id]).toBeCloseTo(total[id], 6);
    }
  });

  it("the winner is unchanged when switching to the eligible basis", () => {
    const winner = (s: Record<string, number>) =>
      Object.entries(s).sort((a, b) => b[1] - a[1])[0][0];
    expect(winner(sharesAt(760_000))).toBe(winner(sharesAt(1_000_000)));
  });
});
