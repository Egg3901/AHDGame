/** Reproducible standing-ad balance fixture; synthetic candidates, no database. */
import assert from "node:assert/strict";
import { buildGranularElectorateSubstrate } from "../../src/lib/demographics/granularElectorate";
import { distributeVotesByGroupLevelAllocation } from "../../src/lib/electionEngine/voteDistribution";
import { distributeVotesBySwingFlow } from "../../src/lib/electionEngine/voteDistributionSwingFlow";
import {
  planAdPurchase,
  adExposure,
  targetedAdBonuses,
  adPurchaseCost,
} from "../../src/lib/campaignTargeting/rules";
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
  region = "PA",
  count = 3
) {
  const a = candidate("a");
  if (advertised)
    a.targetedAds = planAdPurchase(
      [],
      { stateId: "PA", dimension: "race", bucket: "white" },
      10,
      count
    )!;
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
const perfect = {
  id: "perfect",
  share: 1,
  turnout: 50,
  economicLean: 3,
  socialLean: 3,
  buckets: { race: "white" },
  identities: { race: { economicLean: 3, socialLean: 3 } },
};
const saturated = planAdPurchase(
  [],
  { stateId: "PA", dimension: "race", bucket: "white" },
  10,
  25
)!;
assert.equal(targetedAdBonuses([perfect], perfect, saturated, "PA", 10).perfect, 0.25);
assert(adExposure(ads[0], 11) < adExposure(ads[0], 10));
assert.equal(adExposure(ads[0], 34), adExposure(ads[0], 10) / 2);
console.log(
  JSON.stringify(
    {
      fixture:
        "Immediate three-action bonus bought before candidacy; same decaying modifier in current and future races",
      scenarios,
      batches: [1, 5, 10, 25].map((count) => ({
        count,
        cost: adPurchaseCost(count),
        nominalBonus: count / 100,
        share: project(1, 10, true, true, "PA", count).share,
      })),
      immediateBonus: adExposure(ads[0], 10),
      nextTurnBonus: adExposure(ads[0], 11),
      after24Turns: adExposure(ads[0], 34),
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
