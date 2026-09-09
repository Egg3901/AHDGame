/** Reproducible synthetic balance report. No database, player data, or random inputs. */
import assert from "node:assert/strict";
import {
  deriveGranularCellsGeneric,
  type GenericGranularDimInput,
} from "../../src/lib/demographics/granularCells";
import {
  addTurnoutBoost,
  adExposure,
  audienceTurnout,
  canvassingBoost,
  decayTurnout,
  planAdPurchase,
  targetedAdBonuses,
  type CampaignCell,
  type TargetedAd,
} from "../../src/lib/campaignTargeting/rules";
import { distributeVotesByGroupLevelAllocation } from "../../src/lib/electionEngine/voteDistribution";
import type { EnrichedCandidate } from "../../src/lib/electionEngine/types";
import type { DemographicCategory, StateDemographics } from "../../src/lib/db/types";

const right = { economicLean: 3, socialLean: 3 };
const left = { economicLean: -3, socialLean: -3 };
const target = { dimension: "race", bucket: "white" };
const dims: GenericGranularDimInput[] = [
  {
    name: "race",
    marginals: { white: 40, other: 60 },
    positions: { white: right, other: left },
    turnoutRates: { white: 50, other: 50 },
  },
  {
    name: "age",
    marginals: { older: 30, younger: 70 },
    positions: { older: right, younger: left },
    turnoutRates: { older: 50, younger: 50 },
  },
  {
    name: "education",
    marginals: { degree: 40, no_degree: 60 },
    positions: { degree: left, no_degree: right },
    turnoutRates: { degree: 50, no_degree: 50 },
  },
  {
    name: "wealth",
    marginals: { high: 20, low: 80 },
    positions: { high: right, low: left },
    turnoutRates: { high: 50, low: 50 },
  },
];
function electorate(modifier = 0, balanced = false): CampaignCell[] {
  const cells = deriveGranularCellsGeneric({
    dims: dims
      .map((dim) =>
        balanced
          ? {
              ...dim,
              marginals: Object.fromEntries(Object.keys(dim.marginals).map((key) => [key, 50])),
            }
          : dim
      )
      .map((dim) =>
        dim.name === "race"
          ? { ...dim, turnoutRates: { ...dim.turnoutRates, white: 50 + modifier } }
          : dim
      ),
  });
  return cells.map((cell) => ({
    ...cell,
    identities: Object.fromEntries(
      dims.map((dim) => [dim.name, dim.positions?.[cell.buckets[dim.name]] ?? cell])
    ),
  }));
}

const base = electorate();
const candidate = (id: string, ep: number): EnrichedCandidate => ({
  candidateId: id,
  characterId: id,
  characterName: id,
  party: id,
  isNPP: false,
  charEP: ep,
  charSP: ep,
  favorability: 50,
  politicalInfluence: 50,
  nationalInfluence: 50,
});
function shares(
  cells: CampaignCell[],
  ads: TargetedAd[] = [],
  turn = 1,
  opponentAds: TargetedAd[] = [],
  opponentApproval = 50
) {
  const enriched = [candidate("right", 3), candidate("left", -3)].map((c, index) => ({
    ...c,
    favorability: index === 1 ? opponentApproval : c.favorability,
    targetedAdBonuses: targetedAdBonuses(
      cells,
      { economicLean: c.charEP, socialLean: c.charSP },
      index === 0 ? ads : opponentAds,
      "region",
      turn
    ),
  }));
  const demographics: StateDemographics = {
    _id: "region",
    countryId: "US",
    categoryWeights: { cells: 100 },
    groups: Object.fromEntries(
      cells.map((cell) => [
        cell.id,
        {
          population: cell.share * 100,
          economicLean: cell.economicLean,
          socialLean: cell.socialLean,
          turnout: cell.turnout,
        },
      ])
    ),
    lastUpdated: new Date(0),
  };
  const categories: DemographicCategory[] = [
    {
      _id: "cells",
      name: "Cells",
      defaultWeight: 100,
      groups: cells.map((cell) => ({
        id: cell.id,
        name: cell.id,
        defaultEconomicLean: cell.economicLean,
        defaultSocialLean: cell.socialLean,
        defaultTurnout: cell.turnout,
      })),
    },
  ];
  const pool = cells.reduce((sum, cell) => sum + (1_000_000 * cell.share * cell.turnout) / 100, 0);
  const result = distributeVotesByGroupLevelAllocation(
    enriched,
    pool,
    pool,
    1_000_000,
    demographics,
    categories,
    new Map(),
    { votingSystem: "rcv" }
  );
  const total = Object.values(result.votesPerCandidate).reduce((a, b) => a + b, 0);
  assert(Math.abs(total - pool) < 0.01, "campaigning must conserve ballots");
  return { rightShare: (result.votesPerCandidate.right / total) * 100, voters: total };
}

const round = (n: number) => Number(n.toFixed(4));
const baseline = shares(base);
const canvassing = [1, 5, 10, 20, 50].map((actions) => {
  let legacy = 0;
  for (let i = 0; i < actions; i++) legacy += 0.05 * (1 - legacy / 20);
  const modern = addTurnoutBoost(0, canvassingBoost(right, right, false), actions);
  const cells = electorate(modern);
  return {
    actions,
    legacyModifier: round(legacy),
    modernModifier: round(modern),
    legacyTargetTurnout: round(audienceTurnout(electorate(legacy), target)),
    modernTargetTurnout: round(audienceTurnout(cells, target)),
    rightShare: round(shares(cells).rightShare),
    addedVoters: Math.round(shares(cells).voters - baseline.voters),
  };
});
assert(
  canvassing[2].modernTargetTurnout - 50 >= 2.5,
  "ten aligned actions must survive turnout blending"
);

let sustained = 0;
const upkeep = Array.from({ length: 24 }, (_, i) => {
  sustained = decayTurnout({ race: { white: sustained } }).race.white;
  sustained = addTurnoutBoost(sustained, 2);
  return {
    turn: i + 1,
    modifier: round(sustained),
    targetTurnout: round(audienceTurnout(electorate(sustained), target)),
  };
});
const adActions = planAdPurchase([], { ...target, stateId: "region" }, 1, 12)!;
const advertising = [1, 3, 6, 12, 18, 24, 36].map((turn) => {
  const bonuses = targetedAdBonuses(base, right, adActions, "region", turn);
  const matching = base.filter((cell) => cell.buckets.race === "white");
  const values = matching.map((cell) => bonuses[cell.id]);
  assert(
    base.filter((cell) => cell.buckets.race !== "white").every((cell) => bonuses[cell.id] === 0)
  );
  const result = shares(base, adActions, turn);
  return {
    turn,
    exposure: round(adExposure(adActions[0], turn)),
    minMatchingBonusPct: round(Math.min(...values) * 100),
    maxMatchingBonusPct: round(Math.max(...values) * 100),
    rightShare: round(result.rightShare),
    shareGain: round(result.rightShare - baseline.rightShare),
  };
});
assert(advertising[3].shareGain < advertising[0].shareGain);
assert(advertising[6].shareGain < advertising[3].shareGain);
const combined = shares(electorate(addTurnoutBoost(0, 2, 10)), adActions, 12);
assert(combined.rightShare > advertising[3].rightShare);

const closeBefore = shares(electorate(0, true), [], 12, [], 52);
const closeAfter = shares(electorate(addTurnoutBoost(0, 2, 10), true), adActions, 12, [], 52);
assert(
  closeBefore.rightShare < 50 && closeAfter.rightShare > 50,
  "a close race must be contestable through campaigning"
);

console.log(
  JSON.stringify(
    {
      fixture: "Synthetic four-dimension electorate, 1,000,000 eligible voters; no player data",
      baseline: { rightShare: round(baseline.rightShare), voters: Math.round(baseline.voters) },
      closeRace: { before: round(closeBefore.rightShare), after: round(closeAfter.rightShare) },
      canvassing,
      upkeep,
      advertising,
      combined: {
        rightShare: round(combined.rightShare),
        shareGain: round(combined.rightShare - baseline.rightShare),
        voters: Math.round(combined.voters),
      },
      checks: [
        "ballot conservation",
        "turnout boost survives four-way blend",
        "no ads outside selected identity",
        "ad action bonus decays from purchase",
        "canvassing and ads combine",
      ],
    },
    null,
    2
  )
);
