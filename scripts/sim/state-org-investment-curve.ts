/**
 * One-shot diagnostic: how does state-org investment translate to primary
 * vote share when one Dem candidate invests in PA at various levels and an
 * identical-stats rival invests nothing?
 *
 * All other inputs equal: same party position, same ideology, same fav,
 * same NPI, same primary path (applyPartyFit=true). Only the funded
 * candidate's `stateOrgByCandidate` entry varies.
 *
 * Run: npx tsx scripts/sim/state-org-investment-curve.ts
 *
 * Not a unit test — produces narrative output only. Used to explain the
 * curve to players ("level 10 in PA gives you 55-60% in PA against an
 * unfunded rival" etc.).
 */

import { distributeVotesByGroupLevelAllocation } from "@/lib/electionEngine/voteDistribution";
import { shiftDemographicsForPrimary } from "@/lib/campaigns/shiftPrimaryElectorate";
import type { DemographicCategory, StateDemographics, StateDemographicGroup } from "@/lib/db/types";
import type { EnrichedCandidate, DistributeVotesOptions } from "@/lib/electionEngine/types";

const CATEGORIES: DemographicCategory[] = [
  {
    _id: "income",
    name: "Income",
    groups: [
      { id: "low_inc", defaultEconomicLean: -2, defaultSocialLean: -1, defaultTurnout: 45 },
      { id: "mid_inc", defaultEconomicLean: 0, defaultSocialLean: 0, defaultTurnout: 60 },
      { id: "high_inc", defaultEconomicLean: 2, defaultSocialLean: 0, defaultTurnout: 75 },
    ],
  },
  {
    _id: "geography",
    name: "Geography",
    groups: [
      { id: "urban", defaultEconomicLean: -2, defaultSocialLean: -3, defaultTurnout: 55 },
      { id: "suburban", defaultEconomicLean: 0, defaultSocialLean: 0, defaultTurnout: 65 },
      { id: "rural", defaultEconomicLean: 2, defaultSocialLean: 3, defaultTurnout: 60 },
    ],
  },
] as unknown as DemographicCategory[];

const PARTY_POS_DEM = { partyEcon: -2, partySocial: -2 };

const STATE = { id: "PA", pop: 9_000_000, lean: -0.1 };

function demographicsForState(): StateDemographics {
  const pop: Record<string, number> = {
    low_inc: 30,
    mid_inc: 40,
    high_inc: 30,
    urban: 35,
    suburban: 35,
    rural: 30,
  };
  const turnout: Record<string, number> = {
    low_inc: 45,
    mid_inc: 60,
    high_inc: 75,
    urban: 55,
    suburban: 65,
    rural: 60,
  };
  const groups: Record<string, StateDemographicGroup> = {};
  for (const cat of CATEGORIES) {
    for (const g of cat.groups) {
      groups[g.id] = {
        population: pop[g.id] ?? 33,
        turnout: turnout[g.id] ?? 60,
        economicLean: g.defaultEconomicLean,
        socialLean: g.defaultSocialLean,
      };
    }
  }
  return {
    _id: STATE.id,
    categoryWeights: { income: 50, geography: 50 },
    groups,
  } as unknown as StateDemographics;
}

function enriched(candidateId: string, label: string): EnrichedCandidate {
  return {
    candidateId,
    characterId: candidateId,
    characterName: label,
    party: "DEM",
    isNPP: false,
    charEP: PARTY_POS_DEM.partyEcon,
    charSP: PARTY_POS_DEM.partySocial,
    favorability: 55,
    politicalInfluence: 75,
    nationalInfluence: 75,
    support: 50,
    infamy: 0,
    partyEcon: PARTY_POS_DEM.partyEcon,
    partySocial: PARTY_POS_DEM.partySocial,
  } as unknown as EnrichedCandidate;
}

function runMany(
  level: number,
  rivals: number
): { fundedPct: number; rivalPct: number; margin: number } {
  const primaryDemos = shiftDemographicsForPrimary(demographicsForState(), {
    economicPosition: PARTY_POS_DEM.partyEcon,
    socialPosition: PARTY_POS_DEM.partySocial,
  });
  const allCandidates: EnrichedCandidate[] = [enriched("funded", `funded(${level})`)];
  for (let i = 0; i < rivals; i++) {
    allCandidates.push(enriched(`rival${i}`, `rival${i}`));
  }
  const totalPool = Math.round(STATE.pop * 0.6 * 0.13);
  const stateOrgByCandidate = new Map<string, number>();
  if (level > 0) stateOrgByCandidate.set("funded", level);

  const options: DistributeVotesOptions = {
    useAveragedPositions: false,
    partyPositionWeight: 1,
    usePresidentialPartyOrg: true,
    includeInfluenceInAppeal: false,
    useNationalInfluenceForReach: true,
    presidentialPrimaryNationalReach: true,
    applyPartyFit: true,
    currentStateId: STATE.id,
    stateOrgByCandidate,
    homeStateByCandidate: new Map(),
    hasPlayerInRace: true,
    isGeneralElection: false,
    countryId: "US",
  };
  const partyOrgByParty = new Map<string, number>([["DEM", 50]]);
  const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
    allCandidates,
    totalPool,
    totalPool,
    STATE.pop,
    primaryDemos,
    CATEGORIES,
    partyOrgByParty,
    options
  );
  const total = Object.values(votesPerCandidate).reduce((s, v) => s + v, 0);
  if (total === 0)
    return {
      fundedPct: 100 / (1 + rivals),
      rivalPct: 100 / (1 + rivals),
      margin: 0,
    };
  const fundedPct = ((votesPerCandidate.funded ?? 0) / total) * 100;
  // Average rival share — by symmetry all rivals get equal slices.
  const rivalSum = Array.from(
    { length: rivals },
    (_, i) => votesPerCandidate[`rival${i}`] ?? 0
  ).reduce((s, v) => s + v, 0);
  const rivalAvg = rivals > 0 ? (rivalSum / rivals / total) * 100 : 0;
  return { fundedPct, rivalPct: rivalAvg, margin: fundedPct - rivalAvg };
}

function runOne(level: number): { fundedPct: number; unfundedPct: number; margin: number } {
  const primaryDemos = shiftDemographicsForPrimary(demographicsForState(), {
    economicPosition: PARTY_POS_DEM.partyEcon,
    socialPosition: PARTY_POS_DEM.partySocial,
  });
  const candidates = [enriched("funded", `funded(${level})`), enriched("unfunded", "unfunded(0)")];
  const totalPool = Math.round(STATE.pop * 0.6 * 0.13);
  const stateOrgByCandidate = new Map<string, number>();
  if (level > 0) stateOrgByCandidate.set("funded", level);

  const options: DistributeVotesOptions = {
    useAveragedPositions: false,
    partyPositionWeight: 1,
    usePresidentialPartyOrg: true,
    includeInfluenceInAppeal: false,
    useNationalInfluenceForReach: true,
    presidentialPrimaryNationalReach: true,
    applyPartyFit: true,
    currentStateId: STATE.id,
    stateOrgByCandidate,
    homeStateByCandidate: new Map(),
    hasPlayerInRace: true,
    isGeneralElection: false,
    countryId: "US",
  };
  const partyOrgByParty = new Map<string, number>([["DEM", 50]]);
  const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
    candidates,
    totalPool,
    totalPool,
    STATE.pop,
    primaryDemos,
    CATEGORIES,
    partyOrgByParty,
    options
  );
  const total = (votesPerCandidate.funded ?? 0) + (votesPerCandidate.unfunded ?? 0);
  if (total === 0) return { fundedPct: 50, unfundedPct: 50, margin: 0 };
  const fundedPct = ((votesPerCandidate.funded ?? 0) / total) * 100;
  const unfundedPct = ((votesPerCandidate.unfunded ?? 0) / total) * 100;
  return { fundedPct, unfundedPct, margin: fundedPct - unfundedPct };
}

function main(): void {
  console.log("State-org investment curve — funded vs unfunded Dem candidates in PA primary");
  console.log(
    "Identical stats (ideology, fav, NPI). Only the funded candidate's state-org level varies.\n"
  );

  console.log("Level | Multiplier |  Funded%  Unfunded%   Margin");
  console.log("------|------------|----------|----------|--------");
  for (const level of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const { fundedPct, unfundedPct, margin } = runOne(level);
    const mult = (1 + (level / 10) * 0.25).toFixed(3);
    console.log(
      `  ${String(level).padStart(2)}  |   ${mult}×  |  ${fundedPct.toFixed(1).padStart(4)}%  |  ${unfundedPct.toFixed(1).padStart(4)}%  | ${margin >= 0 ? "+" : ""}${margin.toFixed(1)}pp`
    );
  }
  console.log("\nMulti-candidate variants — funded candidate vs N identical unfunded rivals:");
  for (const rivals of [2, 4, 7]) {
    console.log(
      `\n  ${1 + rivals}-way race (1 funded + ${rivals} unfunded) — share-of-${1 + rivals}-candidates`
    );
    console.log("  Level | Multiplier |  Funded%  Avg Rival%   Margin");
    console.log("  ------|------------|----------|-----------|--------");
    for (const level of [0, 3, 5, 7, 10]) {
      const { fundedPct, rivalPct, margin } = runMany(level, rivals);
      const mult = (1 + (level / 10) * 0.25).toFixed(3);
      console.log(
        `    ${String(level).padStart(2)}  |   ${mult}×  |  ${fundedPct.toFixed(1).padStart(4)}%  |   ${rivalPct.toFixed(1).padStart(4)}%   | ${margin >= 0 ? "+" : ""}${margin.toFixed(1)}pp`
      );
    }
  }
  console.log("\nReading: at level 10 in a 3-way race, funded gains ~5pp over each rival.");
  console.log("In an 8-way primary, the gain per rival shrinks but the funded candidate still");
  console.log("collects ~25% more weight than each unfunded peer in that state.");
}

main();
