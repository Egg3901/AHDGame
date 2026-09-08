import { describe, expect, it } from "vitest";
import {
  buildGranularElectorateSubstrate,
  type GranularSubstrateInput,
} from "@/lib/demographics/granularElectorate";
import { distributeVotesByGroupLevelAllocation } from "@/lib/electionEngine/voteDistribution";
import { distributeVotesBySwingFlow } from "@/lib/electionEngine/voteDistributionSwingFlow";
import type { EnrichedCandidate } from "@/lib/electionEngine/types";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { planAdPurchase } from "./rules";

const candidate = (id: string): EnrichedCandidate => ({
  candidateId: id,
  characterId: id,
  characterName: id,
  party: id,
  isNPP: false,
  charEP: 0,
  charSP: 0,
  favorability: 50,
  politicalInfluence: 50,
  nationalInfluence: 50,
});
const input: GranularSubstrateInput = {
  countryId: "US",
  stateId: "PA",
  preset: DEFAULT_SEED_PRESET,
  campaignRulesVersion: 1,
  currentTurn: 10,
  statePopulation: 1_000_000,
  demographics: {
    _id: "PA",
    countryId: "US",
    categoryWeights: {},
    groups: {},
    lastUpdated: new Date(0),
  },
  categories: [],
  enriched: [candidate("A"), candidate("B")],
};
const ads = planAdPurchase([], { stateId: "PA", dimension: "race", bucket: "white" }, 10, 1)!;
const withAds = { ...input, enriched: [{ ...candidate("A"), targetedAds: ads }, candidate("B")] };
function run(data: GranularSubstrateInput, general: boolean) {
  const substrate = buildGranularElectorateSubstrate(data)!;
  expect(substrate).not.toBeNull();
  const distribute = general ? distributeVotesBySwingFlow : distributeVotesByGroupLevelAllocation;
  const votes = distribute(
    substrate.enriched,
    substrate.totalPool,
    substrate.totalPool,
    input.statePopulation,
    substrate.demographics,
    substrate.categories,
    new Map(),
    { isGeneralElection: general, liveTurnouts: substrate.liveTurnouts, votingSystem: "rcv" }
  );
  const total = Object.values(votes.votesPerCandidate).reduce((a, b) => a + b, 0);
  return { substrate, total, share: votes.votesPerCandidate.A / total };
}

describe("campaign effects reach both election distribution paths", () => {
  it.each([false, true])(
    "ads change the competitive share while conserving the turnout pool (general=%s)",
    (general) => {
      const base = run(input, general);
      const active = run(withAds, general);
      expect(base.share).toBeCloseTo(0.5, 6);
      expect(active.share).toBeGreaterThan(base.share);
      expect(active.total).toBeCloseTo(base.total, 5);
      expect(active.substrate.units.map((unit) => unit.id)).toEqual(
        base.substrate.units.map((unit) => unit.id)
      );
      expect(run({ ...withAds, currentTurn: 82 }, general).share).toBeLessThan(active.share);
      expect(run({ ...withAds, campaignRulesVersion: undefined }, general).share).toBeCloseTo(
        base.share,
        6
      );
    }
  );

  it("retains complete voter identities for new rules without altering no-ad demographics", () => {
    const modern = buildGranularElectorateSubstrate(input)!;
    const legacy = buildGranularElectorateSubstrate({ ...input, campaignRulesVersion: undefined })!;
    expect(modern.demographics).toEqual(legacy.demographics);
    expect(modern.campaignCells?.length).toBeGreaterThan(0);
    expect(modern.campaignCells?.every((cell) => Object.keys(cell.identities).length === 4)).toBe(
      true
    );
    expect(legacy.campaignCells).toBeUndefined();
  });
});

it("campaign previews reconcile with counted turnout after live demographic drift", () => {
  const baseline = buildGranularElectorateSubstrate(input)!;
  const shifted = buildGranularElectorateSubstrate({
    ...input,
    demographics: {
      ...input.demographics,
      layer1TurnoutOverrides: { race: { white: 5 } },
    },
  })!;
  const cellPool = shifted.campaignCells!.reduce(
    (sum, cell) => sum + (input.statePopulation * cell.share * cell.turnout) / 100,
    0
  );
  expect(Math.round(cellPool)).toBe(shifted.totalPool);
  expect(shifted.totalPool).toBeGreaterThan(baseline.totalPool);
});
