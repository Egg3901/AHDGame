/**
 * Diagnostic: dump per-group breakdown for the CA Republican primary in
 * scenario P3 to understand why populist Zane (-1, +3) outperforms
 * mainstream Bates (2, 2) and moderate Wells (1, 0) in a deep-blue state.
 *
 * Run: npx tsx scripts/sim/diagnose-ca-rep-primary.ts
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

// CA-blue demographics (matches presidential-eight-way-scenarios.ts).
function makeCaBlueDemos(): StateDemographics {
  const pop: Record<string, number> = {
    low_inc: 35,
    mid_inc: 40,
    high_inc: 25,
    urban: 50,
    suburban: 35,
    rural: 15,
  };
  const turnout: Record<string, number> = {
    low_inc: 45,
    mid_inc: 60,
    high_inc: 75,
    urban: 60,
    suburban: 65,
    rural: 55,
  };
  const leanShift = -1;
  const groups: Record<string, StateDemographicGroup> = {};
  for (const cat of CATEGORIES) {
    for (const g of cat.groups) {
      groups[g.id] = {
        population: pop[g.id] ?? 33,
        turnout: turnout[g.id] ?? 55,
        economicLean: g.defaultEconomicLean + leanShift,
        socialLean: g.defaultSocialLean + leanShift,
      };
    }
  }
  return {
    _id: "CA",
    categoryWeights: { income: 50, geography: 50 },
    groups,
  } as unknown as StateDemographics;
}

const CANDIDATES: EnrichedCandidate[] = [
  {
    candidateId: "wells",
    characterId: "wells",
    characterName: "Wells (mod)",
    party: "REP",
    isNPP: false,
    charEP: 1,
    charSP: 0,
    partyEcon: 2,
    partySocial: 2,
    favorability: 55,
    politicalInfluence: 65,
    nationalInfluence: 65,
    support: 50,
    infamy: 0,
  },
  {
    candidateId: "bates",
    characterId: "bates",
    characterName: "Bates (main)",
    party: "REP",
    isNPP: false,
    charEP: 2,
    charSP: 2,
    partyEcon: 2,
    partySocial: 2,
    favorability: 65,
    politicalInfluence: 90,
    nationalInfluence: 90,
    support: 50,
    infamy: 0,
  },
  {
    candidateId: "xu",
    characterId: "xu",
    characterName: "Xu (cons)",
    party: "REP",
    isNPP: false,
    charEP: 3,
    charSP: 2,
    partyEcon: 2,
    partySocial: 2,
    favorability: 60,
    politicalInfluence: 70,
    nationalInfluence: 70,
    support: 50,
    infamy: 0,
  },
  {
    candidateId: "young",
    characterId: "young",
    characterName: "Young (hr)",
    party: "REP",
    isNPP: false,
    charEP: 3,
    charSP: 4,
    partyEcon: 2,
    partySocial: 2,
    favorability: 50,
    politicalInfluence: 50,
    nationalInfluence: 50,
    support: 50,
    infamy: 0,
  },
  {
    candidateId: "zane",
    characterId: "zane",
    characterName: "Zane (pop)",
    party: "REP",
    isNPP: false,
    charEP: -1,
    charSP: 3,
    partyEcon: 2,
    partySocial: 2,
    favorability: 53,
    politicalInfluence: 55,
    nationalInfluence: 55,
    support: 50,
    infamy: 0,
  },
] as unknown as EnrichedCandidate[];

const baseDemos = makeCaBlueDemos();
const shifted = shiftDemographicsForPrimary(baseDemos, { economicPosition: 2, socialPosition: 2 });

console.log("CA-blue demographics — turnout AFTER primary shift toward REP (2,2):");
for (const [gid, g] of Object.entries(shifted.groups)) {
  const orig = baseDemos.groups[gid]!;
  const retention = (g.turnout ?? 0) / (orig.turnout ?? 1);
  console.log(
    `  ${gid.padEnd(10)} lean=(${orig.economicLean.toString().padStart(2)},${orig.socialLean.toString().padStart(2)}) pop=${orig.population}% turnout ${orig.turnout}→${g.turnout!.toFixed(1)} (×${retention.toFixed(2)})`
  );
}

// Effective electorate: pop × turnout per group, then sum.
let totalEffective = 0;
const effective: Record<string, number> = {};
for (const [gid, g] of Object.entries(shifted.groups)) {
  const w = (g.population ?? 0) * (g.turnout ?? 0);
  effective[gid] = w;
  totalEffective += w;
}
console.log("\nEffective electorate share per group (pop × turnout):");
for (const [gid, w] of Object.entries(effective).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${gid.padEnd(10)} ${((w / totalEffective) * 100).toFixed(1)}%`);
}

const partyOrgByParty = new Map<string, number>([["REP", 25]]); // blue-state REP org
const totalPool = Math.round(25 * 1_000_000 * 0.6 * 0.13); // 1.95M primary pool

const options: DistributeVotesOptions = {
  useAveragedPositions: false,
  partyPositionWeight: 1,
  usePresidentialPartyOrg: true,
  includeInfluenceInAppeal: false,
  useNationalInfluenceForReach: true,
  presidentialPrimaryNationalReach: true,
  hasPlayerInRace: true,
  isGeneralElection: false,
  countryId: "US",
};

const { votesPerCandidate, sharesPct } = distributeVotesByGroupLevelAllocation(
  CANDIDATES,
  totalPool,
  totalPool,
  25 * 1_000_000,
  shifted,
  CATEGORIES,
  partyOrgByParty,
  options
);

console.log("\nFull-state result (CA REP primary):");
const sorted = Object.entries(votesPerCandidate).sort((a, b) => b[1] - a[1]);
for (const [cid, v] of sorted) {
  const c = CANDIDATES.find((x) => x.candidateId === cid)!;
  console.log(
    `  ${c.characterName.padEnd(14)} pos=(${c.charEP.toString().padStart(2)},${c.charSP.toString().padStart(2)}) votes=${Math.round(v).toLocaleString().padStart(10)}  ${sharesPct[cid]!.toFixed(1)}%`
  );
}
