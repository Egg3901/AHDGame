/**
 * Full primary lever sweep — exercises every primary-side lever in the
 * engine at multiple intensities so we can spot dominant levers, dead
 * levers, and bad stacking interactions.
 *
 * Levers covered:
 *   L1 — party-fit penalty           (PRIMARY_PARTY_FIT_WEIGHT = 0.3)
 *   L2 — tribal-bonus party gate     (binary; baked into calcAppeal)
 *   L4 — in-state campaign ticks     (PRIMARY_CAMPAIGN_STAGGER_TICK_RATE = 0.05, cap 5)
 *   B  — per-character state org     (MAX_STATE_ORG_BONUS_PRIMARY = 0.25 at level 10)
 *   C  — home-state primary bump     (HOME_STATE_BONUS_PRIMARY = 0.10)
 *   NPP penalty in player primary    (0.48× combined)
 *
 * Run: npx tsx scripts/sim/full-primary-sweep.ts
 *
 * NOT a unit test. Generates a narrative report with vote shares,
 * margins, and outlier flags.
 */

import { distributeVotesByGroupLevelAllocation } from "@/lib/electionEngine/voteDistribution";
import { shiftDemographicsForPrimary } from "@/lib/campaigns/shiftPrimaryElectorate";
import {
  PRIMARY_CAMPAIGN_STAGGER_TICK_RATE,
  NPP_STAGGER_EXTRA_MULTIPLIER,
  MAX_STATE_ORG_BONUS_PRIMARY,
  HOME_STATE_BONUS_PRIMARY,
  PRIMARY_PARTY_FIT_WEIGHT,
  STATE_ORG_MAX_LEVEL,
} from "@/lib/electionEngine/constants";
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
const STATE_PA = { id: "PA", pop: 9_000_000 };

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
    _id: STATE_PA.id,
    categoryWeights: { income: 50, geography: 50 },
    groups,
  } as unknown as StateDemographics;
}

interface SimCand {
  id: string;
  label: string;
  isNPP?: boolean;
  charEP: number;
  charSP: number;
  fav?: number;
  npi?: number;
  /** state-org level for this candidate in PA */
  orgLevel?: number;
  /** if set, this is the candidate's home state (for the C bump) */
  homeState?: string;
  /** in-state campaign ticks for PA (0-5) */
  ticks?: number;
}

function enrich(c: SimCand): EnrichedCandidate {
  return {
    candidateId: c.id,
    characterId: c.id,
    characterName: c.label,
    party: "DEM",
    isNPP: Boolean(c.isNPP),
    charEP: c.charEP,
    charSP: c.charSP,
    favorability: c.fav ?? 55,
    politicalInfluence: c.npi ?? 75,
    nationalInfluence: c.npi ?? 75,
    support: 50,
    infamy: 0,
    partyEcon: PARTY_POS_DEM.partyEcon,
    partySocial: PARTY_POS_DEM.partySocial,
  } as unknown as EnrichedCandidate;
}

function runScenario(cands: SimCand[]): Record<string, number> {
  const primaryDemos = shiftDemographicsForPrimary(demographicsForState(), {
    economicPosition: PARTY_POS_DEM.partyEcon,
    socialPosition: PARTY_POS_DEM.partySocial,
  });
  const enriched = cands.map(enrich);
  const totalPool = Math.round(STATE_PA.pop * 0.6 * 0.13);

  const stateOrgByCandidate = new Map<string, number>();
  const homeStateByCandidate = new Map<string, string>();
  for (const c of cands) {
    if (c.orgLevel && c.orgLevel > 0) stateOrgByCandidate.set(c.id, c.orgLevel);
    if (c.homeState) homeStateByCandidate.set(c.id, c.homeState);
  }

  const options: DistributeVotesOptions = {
    useAveragedPositions: false,
    partyPositionWeight: 1,
    usePresidentialPartyOrg: true,
    includeInfluenceInAppeal: false,
    useNationalInfluenceForReach: true,
    presidentialPrimaryNationalReach: true,
    applyPartyFit: true,
    currentStateId: STATE_PA.id,
    stateOrgByCandidate,
    homeStateByCandidate,
    hasPlayerInRace: cands.some((c) => !c.isNPP),
    isGeneralElection: false,
    countryId: "US",
  };
  const partyOrgByParty = new Map<string, number>([["DEM", 50]]);
  const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
    enriched,
    totalPool,
    totalPool,
    STATE_PA.pop,
    primaryDemos,
    CATEGORIES,
    partyOrgByParty,
    options
  );

  // Apply L4 tick multiplier (post-distribution, matches primaryStaggerPhase).
  for (const c of cands) {
    if (!c.ticks || c.ticks <= 0) continue;
    const mult = 1 + Math.min(c.ticks, 5) * PRIMARY_CAMPAIGN_STAGGER_TICK_RATE;
    votesPerCandidate[c.id] = (votesPerCandidate[c.id] ?? 0) * mult;
  }
  // NPP penalty (player in primary).
  const hasPlayer = cands.some((c) => !c.isNPP);
  if (hasPlayer) {
    for (const c of cands) {
      if (c.isNPP) {
        votesPerCandidate[c.id] = (votesPerCandidate[c.id] ?? 0) * NPP_STAGGER_EXTRA_MULTIPLIER;
      }
    }
  }

  const total = Object.values(votesPerCandidate).reduce((s, v) => s + v, 0);
  const shares: Record<string, number> = {};
  for (const c of cands)
    shares[c.id] = total > 0 ? ((votesPerCandidate[c.id] ?? 0) / total) * 100 : 0;
  return shares;
}

function fmt(s: Record<string, number>): string {
  return Object.entries(s)
    .map(([k, v]) => `${k}=${v.toFixed(1)}%`)
    .join("  ");
}

// ── Sweeps ─────────────────────────────────────────────────────────────────

function sweep1_singleLever(): void {
  console.log("\n══ S1. Single-lever effect at varying intensity (3-way Dem PA primary)");
  console.log("    All three candidates identical: charEP=-2, charSP=-2, fav=55, npi=75.");
  console.log("    Only the 'target' candidate has the lever; other two are unmodified.\n");

  const base = (extra: Partial<SimCand> = {}): SimCand[] => [
    { id: "T", label: "Target", charEP: -2, charSP: -2, ...extra },
    { id: "R1", label: "Rival1", charEP: -2, charSP: -2 },
    { id: "R2", label: "Rival2", charEP: -2, charSP: -2 },
  ];

  console.log("  Lever                  | Target%  Rival avg%  Margin");
  console.log("  -----------------------|---------|------------|-------");

  const rows: Array<{ label: string; T: number; R: number }> = [];

  for (const orgLevel of [0, 3, 5, 7, 10]) {
    const s = runScenario(base({ orgLevel }));
    rows.push({ label: `State org level ${orgLevel}`, T: s.T, R: (s.R1 + s.R2) / 2 });
  }
  for (const ticks of [1, 3, 5]) {
    const s = runScenario(base({ ticks }));
    rows.push({ label: `Campaign ticks ${ticks}`, T: s.T, R: (s.R1 + s.R2) / 2 });
  }
  {
    const s = runScenario(base({ homeState: "PA" }));
    rows.push({ label: "Home state (PA)", T: s.T, R: (s.R1 + s.R2) / 2 });
  }
  for (const r of rows) {
    const margin = r.T - r.R;
    console.log(
      `  ${r.label.padEnd(22)} |  ${r.T.toFixed(1).padStart(4)}%  |   ${r.R.toFixed(1).padStart(4)}%   | ${margin >= 0 ? "+" : ""}${margin.toFixed(1)}pp`
    );
  }
}

function sweep2_combinations(): void {
  console.log(
    "\n══ S2. Lever stacking (3-way Dem PA primary, all candidates ideologically identical)"
  );
  console.log("    Target candidate combines two or more levers; rivals get nothing.\n");

  const base = (extra: Partial<SimCand> = {}): SimCand[] => [
    { id: "T", label: "Target", charEP: -2, charSP: -2, ...extra },
    { id: "R1", label: "Rival1", charEP: -2, charSP: -2 },
    { id: "R2", label: "Rival2", charEP: -2, charSP: -2 },
  ];

  console.log("  Stack                                           | Target%  Margin");
  console.log("  ------------------------------------------------|--------|-------");
  const stacks: Array<{ label: string; cfg: Partial<SimCand> }> = [
    { label: "Org 10                                          ", cfg: { orgLevel: 10 } },
    {
      label: "Home + Org 5                                    ",
      cfg: { homeState: "PA", orgLevel: 5 },
    },
    {
      label: "Home + Org 10                                   ",
      cfg: { homeState: "PA", orgLevel: 10 },
    },
    {
      label: "Home + Camp 5                                   ",
      cfg: { homeState: "PA", ticks: 5 },
    },
    { label: "Org 10 + Camp 5                                 ", cfg: { orgLevel: 10, ticks: 5 } },
    {
      label: "Home + Org 10 + Camp 5 (fully decked)           ",
      cfg: { homeState: "PA", orgLevel: 10, ticks: 5 },
    },
  ];
  for (const st of stacks) {
    const s = runScenario(base(st.cfg));
    const margin = s.T - (s.R1 + s.R2) / 2;
    console.log(
      `  ${st.label} |  ${s.T.toFixed(1).padStart(4)}%  | ${margin >= 0 ? "+" : ""}${margin.toFixed(1)}pp`
    );
  }
}

function sweep3_crossPressureRecovery(): void {
  console.log("\n══ S3. Cross-pressure recovery — can investment overcome ideology gap?");
  console.log("    Target is 1-axis or 2-axis off the party position. Rivals are perfectly fit.\n");
  const rivals = (): SimCand[] => [
    { id: "R1", label: "Rival1(fit)", charEP: -2, charSP: -2 },
    { id: "R2", label: "Rival2(fit)", charEP: -2, charSP: -2 },
  ];

  console.log("  Setup                                       | Target%  Wins?");
  console.log("  --------------------------------------------|---------|------");
  type Row = { label: string; cands: SimCand[] };
  const rows: Row[] = [
    {
      label: "1-axis off, no boost                        ",
      cands: [{ id: "T", label: "Target", charEP: 0, charSP: -2 }, ...rivals()],
    },
    {
      label: "1-axis off + Org 10                         ",
      cands: [{ id: "T", label: "Target", charEP: 0, charSP: -2, orgLevel: 10 }, ...rivals()],
    },
    {
      label: "1-axis off + Home + Org 10 + Camp 5         ",
      cands: [
        {
          id: "T",
          label: "Target",
          charEP: 0,
          charSP: -2,
          orgLevel: 10,
          homeState: "PA",
          ticks: 5,
        },
        ...rivals(),
      ],
    },
    {
      label: "2-axis off (centrist), no boost             ",
      cands: [{ id: "T", label: "Target", charEP: 0, charSP: 0 }, ...rivals()],
    },
    {
      label: "2-axis off + Home + Org 10 + Camp 5         ",
      cands: [
        { id: "T", label: "Target", charEP: 0, charSP: 0, orgLevel: 10, homeState: "PA", ticks: 5 },
        ...rivals(),
      ],
    },
    {
      label: "3-axis off (Park-style), no boost           ",
      cands: [{ id: "T", label: "Target", charEP: 1, charSP: 1 }, ...rivals()],
    },
    {
      label: "3-axis off + Home + Org 10 + Camp 5         ",
      cands: [
        { id: "T", label: "Target", charEP: 1, charSP: 1, orgLevel: 10, homeState: "PA", ticks: 5 },
        ...rivals(),
      ],
    },
  ];
  for (const row of rows) {
    const s = runScenario(row.cands);
    const wins = s.T > s.R1 && s.T > s.R2;
    console.log(`  ${row.label} |  ${s.T.toFixed(1).padStart(4)}%  | ${wins ? "YES" : "no"}`);
  }
}

function sweep4_fieldSize(): void {
  console.log("\n══ S4. Field size — how does Org 10 + Home + Camp 5 scale with field size?\n");
  console.log("  Field   | Target%  Avg rival%  Margin");
  console.log("  --------|---------|------------|-------");
  for (const rivals of [1, 2, 4, 7]) {
    const cands: SimCand[] = [
      { id: "T", label: "Target", charEP: -2, charSP: -2, orgLevel: 10, homeState: "PA", ticks: 5 },
    ];
    for (let i = 0; i < rivals; i++) {
      cands.push({ id: `R${i}`, label: `Rival${i}`, charEP: -2, charSP: -2 });
    }
    const s = runScenario(cands);
    const rivalAvg =
      rivals > 0
        ? Array.from({ length: rivals }, (_, i) => s[`R${i}`]).reduce((a, b) => a + b, 0) / rivals
        : 0;
    const margin = s.T - rivalAvg;
    console.log(
      `  ${rivals + 1}-way   |  ${s.T.toFixed(1).padStart(4)}%  |   ${rivalAvg.toFixed(1).padStart(4)}%   | +${margin.toFixed(1)}pp`
    );
  }
}

function sweep5_nppPenalty(): void {
  console.log("\n══ S5. NPP penalty — player vs NPP at equal stats");
  console.log(
    "    Both candidates identical except one is an NPP. Combined NPP penalty is 0.8 × 0.6 = 0.48×.\n"
  );
  const cands: SimCand[] = [
    { id: "P", label: "Player", charEP: -2, charSP: -2 },
    { id: "N", label: "NPP", charEP: -2, charSP: -2, isNPP: true },
  ];
  const s = runScenario(cands);
  console.log(`  Player vs NPP (no investment): ${fmt(s)}`);

  // What if NPP has SUPERIOR stats? Can NPP still win?
  const cands2: SimCand[] = [
    { id: "P", label: "Player(weaker)", charEP: -2, charSP: -2, fav: 50, npi: 60 },
    { id: "N", label: "NPP(stronger)", charEP: -2, charSP: -2, fav: 70, npi: 90, isNPP: true },
  ];
  const s2 = runScenario(cands2);
  console.log(`  Player(fav50/npi60) vs NPP(fav70/npi90): ${fmt(s2)}`);
}

function sweep6_partyFitDecay(): void {
  console.log("\n══ S6. Party-fit penalty — how the L1 multiplier decays with distance");
  console.log("    Single candidate metric: weight multiplier = 1 - 0.3 × (1 - rawFit)");
  console.log("    where rawFit = max(0, 1 - manhattan(cand, party) / 6).\n");
  console.log("  Manhattan dist | rawFit | partyFit mult");
  console.log("  ---------------|--------|--------------");
  for (const dist of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const rawFit = Math.max(0, 1 - dist / 6);
    const mult = 1 - PRIMARY_PARTY_FIT_WEIGHT * (1 - rawFit);
    console.log(
      `        ${String(dist).padStart(2)}      |  ${rawFit.toFixed(2)}  |    ${mult.toFixed(3)}`
    );
  }
}

function main(): void {
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("  Full primary lever sweep — current calibration");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log(`  PRIMARY_PARTY_FIT_WEIGHT     = ${PRIMARY_PARTY_FIT_WEIGHT}`);
  console.log(
    `  PRIMARY_CAMPAIGN_TICK_RATE   = ${PRIMARY_CAMPAIGN_STAGGER_TICK_RATE} (max 5 ticks)`
  );
  console.log(
    `  MAX_STATE_ORG_BONUS_PRIMARY          = ${MAX_STATE_ORG_BONUS_PRIMARY} (at level ${STATE_ORG_MAX_LEVEL})`
  );
  console.log(`  HOME_STATE_BONUS_PRIMARY     = ${HOME_STATE_BONUS_PRIMARY}`);
  console.log(`  NPP_STAGGER_EXTRA_MULTIPLIER = ${NPP_STAGGER_EXTRA_MULTIPLIER}`);

  sweep1_singleLever();
  sweep2_combinations();
  sweep3_crossPressureRecovery();
  sweep4_fieldSize();
  sweep5_nppPenalty();
  sweep6_partyFitDecay();
}

main();
