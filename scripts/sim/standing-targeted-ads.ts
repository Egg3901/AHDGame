/** Reproducible standing-ad balance fixture; synthetic candidates, no database. */
import assert from "node:assert/strict";
import { buildGranularElectorateSubstrate } from "../../src/lib/demographics/granularElectorate";
import { distributeVotesByGroupLevelAllocation } from "../../src/lib/electionEngine/voteDistribution";
import { distributeVotesBySwingFlow } from "../../src/lib/electionEngine/voteDistributionSwingFlow";
import { planAdPurchase } from "../../src/lib/campaignTargeting/rules";
import type { EnrichedCandidate } from "../../src/lib/electionEngine/types";

const ads = planAdPurchase([], { stateId: "PA", dimension: "race", bucket: "white" }, 10, 3)!;
const candidate = (id: string): EnrichedCandidate => ({
  candidateId: id,
  characterId: id,
  characterName: "Synthetic",
  party: id,
  isNPP: false,
  charEP: 0,
  charSP: 0,
  favorability: 50,
  politicalInfluence: 50,
  nationalInfluence: 50,
});
function project(
  version: number,
  turn: number,
  general: boolean,
  advertised: boolean,
  region = "PA"
) {
  const a = candidate("a");
  if (advertised) a.targetedAds = ads;
  const substrate = buildGranularElectorateSubstrate({
    countryId: "US",
    stateId: region,
    statePopulation: 1_000_000,
    currentTurn: turn,
    campaignRulesVersion: version,
    demographics: {
      _id: region,
      countryId: "US",
      groups: {},
      categoryWeights: {},
      lastUpdated: new Date(0),
    },
    categories: [],
    enriched: [a, candidate("b")],
  })!;
  const allocate = general ? distributeVotesBySwingFlow : distributeVotesByGroupLevelAllocation;
  const result = allocate(
    substrate.enriched,
    substrate.totalPool,
    substrate.totalPool,
    1_000_000,
    substrate.demographics,
    substrate.categories,
    new Map(),
    { isGeneralElection: general, liveTurnouts: substrate.liveTurnouts, votingSystem: "rcv" }
  );
  const total = Object.values(result.votesPerCandidate).reduce((sum, votes) => sum + votes, 0);
  return { share: result.votesPerCandidate.a / total, total };
}
const scenarios = [0, 1].flatMap((version) =>
  [false, true].map((general) => {
    const baseline = project(version, 12, general, false);
    const current = project(version, 12, general, true);
    const laterRace = project(version, 24, general, true);
    const decayed = project(version, 84, general, true);
    const elsewhere = project(version, 12, general, true, "CA");
    assert(
      current.share > laterRace.share &&
        laterRace.share > decayed.share &&
        decayed.share > baseline.share
    );
    assert(Math.abs(current.total - baseline.total) < 0.001);
    assert(Math.abs(elsewhere.share - project(version, 12, general, false, "CA").share) < 1e-10);
    return {
      version,
      general,
      baseline: baseline.share,
      current: current.share,
      laterRace: laterRace.share,
      decayed: decayed.share,
      totalVoters: current.total,
    };
  })
);
console.log(
  JSON.stringify(
    {
      fixture:
        "One prepaid three-turn flight bought before candidacy; same exposure in separate current and future races",
      scenarios,
      checks: [
        "legacy and modern races receive ads",
        "same exposure carries across races",
        "exposure decays between races",
        "regional isolation",
        "ballot conservation",
      ],
    },
    null,
    2
  )
);
