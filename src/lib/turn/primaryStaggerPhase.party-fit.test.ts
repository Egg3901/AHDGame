/**
 * L1 integration test: verifies that the DistributeVotesOptions shape
 * primaryStaggerPhase produces (applyPartyFit: true) actually shifts
 * share toward the party-aligned candidate when the centrist sits at
 * (0, 0) and the party at (-3, -3). Exercises the partyFit multiplier
 * through the distributeVotesByGroupLevelAllocation path; does NOT
 * mock the math.
 */
import { describe, it, expect } from "vitest";
import { distributeVotesByGroupLevelAllocation } from "@/lib/electionEngine/voteDistribution";
import type { EnrichedCandidate, DistributeVotesOptions } from "@/lib/electionEngine/types";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types";

describe("primaryStaggerPhase L1 — party-fit", () => {
  it("applyPartyFit shifts share toward the party-aligned candidate", () => {
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
      } as unknown as DemographicCategory,
    ];
    const demographics: StateDemographics = {
      _id: "PA",
      categoryWeights: { ideology: 100 },
      groups: {
        liberal: { population: 50, turnout: 60, economicLean: -3, socialLean: -3 },
        conservative: { population: 50, turnout: 60, economicLean: 3, socialLean: 3 },
      },
    } as unknown as StateDemographics;

    const aligned: EnrichedCandidate = {
      candidateId: "aligned",
      characterId: "aligned",
      characterName: "Aligned",
      party: "DEM",
      isNPP: false,
      charEP: -3,
      charSP: -3,
      favorability: 50,
      politicalInfluence: 80,
      nationalInfluence: 80,
      partyEcon: -3,
      partySocial: -3,
    } as unknown as EnrichedCandidate;
    const centrist: EnrichedCandidate = {
      candidateId: "centrist",
      characterId: "centrist",
      characterName: "Centrist",
      party: "DEM",
      isNPP: false,
      charEP: 0,
      charSP: 0,
      favorability: 50,
      politicalInfluence: 80,
      nationalInfluence: 80,
      partyEcon: -3,
      partySocial: -3,
    } as unknown as EnrichedCandidate;

    const baseOptions: DistributeVotesOptions = {
      useAveragedPositions: false,
      usePresidentialPartyOrg: true,
      includeInfluenceInAppeal: false,
      useNationalInfluenceForReach: true,
      presidentialPrimaryNationalReach: true,
      hasPlayerInRace: true,
    };

    const without = distributeVotesByGroupLevelAllocation(
      [aligned, centrist],
      10_000,
      600_000,
      1_000_000,
      demographics,
      categories,
      new Map<string, number>(),
      baseOptions
    );
    // Same inputs, only applyPartyFit toggled — matches the option literal
    // primaryStaggerPhase.ts uses for the primary path.
    const withFit = distributeVotesByGroupLevelAllocation(
      [aligned, centrist],
      10_000,
      600_000,
      1_000_000,
      demographics,
      categories,
      new Map<string, number>(),
      { ...baseOptions, applyPartyFit: true }
    );

    expect(withFit.votesPerCandidate.aligned).toBeGreaterThan(without.votesPerCandidate.aligned);
    expect(withFit.votesPerCandidate.centrist).toBeLessThan(without.votesPerCandidate.centrist);
  });
});
