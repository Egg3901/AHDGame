/**
 * Primary electorate retention must survive the US Layer-1 liveTurnout path.
 *
 * Regression: stagger called shiftDemographicsForPrimary, then resolveTurnout
 * (which rebuilds US turnouts from census baselines), then passed those
 * liveTurnouts into distributeVotes — wiping the primary shift. Projection
 * (no liveTurnouts) kept the shifted electorate, so a party-base favorite
 * could project as the national leader while a general-electorate favorite
 * swept every called state.
 */
import { describe, it, expect } from "vitest";
import {
  applyPrimaryTurnoutRetention,
  computeTurnoutPoolFromRates,
  primaryTurnoutRetention,
  shiftDemographicsForPrimary,
} from "./shiftPrimaryElectorate";
import { distributeVotesByGroupLevelAllocation } from "@/lib/electionEngine/voteDistribution";
import type { EnrichedCandidate } from "@/lib/electionEngine/types";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types";

const GOP = { economicPosition: 3, socialPosition: 3 };

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
        defaultTurnout: 70,
      },
      {
        id: "conservative",
        name: "Conservatives",
        defaultEconomicLean: 3,
        defaultSocialLean: 3,
        defaultTurnout: 70,
      },
    ],
  } as unknown as DemographicCategory,
];

const demographics: StateDemographics = {
  _id: "SC",
  categoryWeights: { ideology: 100 },
  groups: {
    liberal: { population: 45, turnout: 70, economicLean: -3, socialLean: -3 },
    conservative: { population: 55, turnout: 70, economicLean: 3, socialLean: 3 },
  },
} as unknown as StateDemographics;

/** Layer-1-style general turnouts that ignore any demographics.groups.turnout shift. */
const generalLiveTurnouts = { liberal: 70, conservative: 70 };

function makeCandidate(
  id: string,
  ep: number,
  sp: number,
  extras: Partial<EnrichedCandidate> = {}
): EnrichedCandidate {
  return {
    candidateId: id,
    characterId: id,
    characterName: id,
    party: "2",
    isNPP: false,
    charEP: ep,
    charSP: sp,
    favorability: 80,
    politicalInfluence: 80,
    nationalInfluence: 80,
    partyEcon: GOP.economicPosition,
    partySocial: GOP.socialPosition,
    partyInfluence: 50,
    ...extras,
  };
}

describe("primaryTurnoutRetention", () => {
  it("fully retains aligned voters and floors opposed voters", () => {
    expect(primaryTurnoutRetention(3, 3, GOP)).toBe(1);
    expect(primaryTurnoutRetention(-3, -3, GOP)).toBe(0.05);
    expect(primaryTurnoutRetention(0, 0, GOP)).toBe(0.5);
  });
});

describe("applyPrimaryTurnoutRetention vs demographics-only shift", () => {
  it("scales a liveTurnout map the same way shiftDemographicsForPrimary scales stored turnout", () => {
    const shifted = shiftDemographicsForPrimary(demographics, GOP);
    const retained = applyPrimaryTurnoutRetention(generalLiveTurnouts, demographics, GOP);

    expect(retained.conservative).toBeCloseTo(shifted.groups.conservative.turnout ?? 0, 5);
    expect(retained.liberal).toBeCloseTo(shifted.groups.liberal.turnout ?? 0, 5);
  });
});

describe("primary electorate vs wiped liveTurnouts — winner parity", () => {
  it("wiping the primary shift (old stagger bug) can flip the state winner vs projection", () => {
    // Party-aligned conservative vs high-reach moderate who wins the general electorate.
    const baseFavorite = makeCandidate("base", 3, 3, {
      nationalInfluence: 60,
      partyInfluence: 120,
    });
    const generalFavorite = makeCandidate("general", 0.5, 0.5, {
      nationalInfluence: 150,
      partyInfluence: 20,
      favorability: 95,
    });

    const shifted = shiftDemographicsForPrimary(demographics, GOP);
    const population = 1_000_000;
    const primaryPool = Math.round(population * 0.13);

    // Projection path: shifted demographics, no liveTurnouts.
    const projection = distributeVotesByGroupLevelAllocation(
      [baseFavorite, generalFavorite],
      primaryPool,
      primaryPool,
      population,
      shifted,
      categories,
      new Map(),
      {
        useAveragedPositions: false,
        includeInfluenceInAppeal: false,
        useNationalInfluenceForReach: true,
        presidentialPrimaryNationalReach: true,
        applyPartyFit: true,
        currentStateId: "SC",
        countryId: "US",
        hasPlayerInRace: true,
      }
    );

    // Old stagger bug: Layer-1 general liveTurnouts override the shift.
    const wipedStagger = distributeVotesByGroupLevelAllocation(
      [baseFavorite, generalFavorite],
      primaryPool,
      primaryPool,
      population,
      shifted,
      categories,
      new Map(),
      {
        useAveragedPositions: false,
        includeInfluenceInAppeal: false,
        useNationalInfluenceForReach: true,
        presidentialPrimaryNationalReach: true,
        applyPartyFit: true,
        currentStateId: "SC",
        countryId: "US",
        hasPlayerInRace: true,
        liveTurnouts: generalLiveTurnouts,
      }
    );

    const projWinner =
      projection.votesPerCandidate.base > projection.votesPerCandidate.general ? "base" : "general";
    const wipedWinner =
      wipedStagger.votesPerCandidate.base > wipedStagger.votesPerCandidate.general
        ? "base"
        : "general";

    // Document the bug shape: primary-base projection vs general-electorate result.
    expect(projWinner).toBe("base");
    expect(wipedWinner).toBe("general");
  });

  it("applying retention to liveTurnouts restores projection/stagger winner agreement", () => {
    const baseFavorite = makeCandidate("base", 3, 3, {
      nationalInfluence: 60,
      partyInfluence: 120,
    });
    const generalFavorite = makeCandidate("general", 0.5, 0.5, {
      nationalInfluence: 150,
      partyInfluence: 20,
      favorability: 95,
    });

    const shifted = shiftDemographicsForPrimary(demographics, GOP);
    const retainedTurnouts = applyPrimaryTurnoutRetention(generalLiveTurnouts, demographics, GOP);
    const population = 1_000_000;
    const retainedPool = computeTurnoutPoolFromRates(
      population,
      demographics,
      categories,
      retainedTurnouts
    );
    const turnPool = Math.round(retainedPool * 0.13);
    // Projection uses population×0.13 as both pools; relative shares matter.
    const projectionPool = Math.round(population * 0.13);

    const projection = distributeVotesByGroupLevelAllocation(
      [baseFavorite, generalFavorite],
      projectionPool,
      projectionPool,
      population,
      shifted,
      categories,
      new Map(),
      {
        useAveragedPositions: false,
        includeInfluenceInAppeal: false,
        useNationalInfluenceForReach: true,
        presidentialPrimaryNationalReach: true,
        applyPartyFit: true,
        currentStateId: "SC",
        countryId: "US",
        hasPlayerInRace: true,
      }
    );

    const fixedStagger = distributeVotesByGroupLevelAllocation(
      [baseFavorite, generalFavorite],
      turnPool,
      retainedPool,
      population,
      demographics,
      categories,
      new Map(),
      {
        useAveragedPositions: false,
        includeInfluenceInAppeal: false,
        useNationalInfluenceForReach: true,
        presidentialPrimaryNationalReach: true,
        applyPartyFit: true,
        currentStateId: "SC",
        countryId: "US",
        hasPlayerInRace: true,
        liveTurnouts: retainedTurnouts,
      }
    );

    const projWinner =
      projection.votesPerCandidate.base > projection.votesPerCandidate.general ? "base" : "general";
    const staggerWinner =
      fixedStagger.votesPerCandidate.base > fixedStagger.votesPerCandidate.general
        ? "base"
        : "general";

    expect(projWinner).toBe("base");
    expect(staggerWinner).toBe("base");

    const projShare =
      projection.votesPerCandidate.base /
      (projection.votesPerCandidate.base + projection.votesPerCandidate.general);
    const staggerShare =
      fixedStagger.votesPerCandidate.base /
      (fixedStagger.votesPerCandidate.base + fixedStagger.votesPerCandidate.general);
    expect(Math.abs(projShare - staggerShare)).toBeLessThan(0.02);
  });
});
