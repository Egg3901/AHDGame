/**
 * One-off simulation harness for the updated §7.3.2 swing-flow
 * presidential engine. NOT a test — intentionally lives under
 * scripts/sim/ so we can iterate on scenarios without touching the
 * production test suite.
 *
 * Run: npx tsx scripts/sim/election-simulation.ts
 *
 * What this exercises:
 *   - distributeVotesBySwingFlow per state (the pure §7.3.2 engine)
 *   - shiftDemographicsForPrimary for primary electorate scaling
 *   - turnVoteWeight to confirm per-turn pool distribution
 *   - persuasionDrivers indirectly via fundsByParty +
 *     incumbentSeatShareByParty + support deltas
 *
 * The script builds a synthetic 15-state US-shaped electorate with
 * three archetypes (blue/red/swing) and runs eight scenarios:
 *   General  G1: baseline two-party
 *   General  G2: Dem 5x funds advantage
 *   General  G3: support polarization (Dem 80, Rep 30)
 *   General  G4: NPP center-left spoiler in three-way FPTP
 *   General  G5: high-Reg Rep incumbent vs low-Reg Dem challenger
 *   General  G6: incumbent-seat-share defender (Rep 100%)
 *   Primary  P1: Dem primary, three Dem candidates (centrist/moderate/extreme)
 *   Primary  P2: Rep primary, three Rep candidates (moderate/conservative/extreme)
 *
 * No DB, no network. All inputs are local fixtures.
 */

import { distributeVotesBySwingFlow } from "@/lib/electionEngine/voteDistributionSwingFlow";
import { shiftDemographicsForPrimary } from "@/lib/campaigns/shiftPrimaryElectorate";
import { turnVoteWeight } from "@/lib/electionEngine/voteCalculations";
import { supportMoodMultiplier } from "@/lib/electionEngine/electionFormulaFactors";
import {
  getDelegatesForState,
  getDefaultPrimaryAllocation,
  getTotalDelegatesForFamily,
  getDelegateMajority,
  type PrimaryCalendarFamily,
} from "@/lib/constants/primaryCalendar";
import { allocateDelegates, type AllocationMethod } from "@/lib/primaryDelegateAllocation";
import type { DemographicCategory, StateDemographics, StateDemographicGroup } from "@/lib/db/types";
import type { EnrichedCandidate, DistributeVotesOptions } from "@/lib/electionEngine/types";

// ─── Fixture: demographic categories (shared across states) ──────────────

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

// ─── Fixture: 15 synthetic US-shaped states ──────────────────────────────
// Real-world EV-style proportions: a couple of mega-states, several big,
// rest mid-tier. Population in millions of eligible voters.

interface SimState {
  id: string;
  name: string;
  pop: number; // millions
  ev: number; // electoral votes
  archetype: "blue" | "red" | "swing";
}

const STATES: SimState[] = [
  { id: "CA", name: "California", pop: 25, ev: 54, archetype: "blue" },
  { id: "TX", name: "Texas", pop: 19, ev: 40, archetype: "red" },
  { id: "FL", name: "Florida", pop: 15, ev: 30, archetype: "red" },
  { id: "NY", name: "New York", pop: 13, ev: 28, archetype: "blue" },
  { id: "PA", name: "Pennsylvania", pop: 9, ev: 19, archetype: "swing" },
  { id: "IL", name: "Illinois", pop: 9, ev: 19, archetype: "blue" },
  { id: "OH", name: "Ohio", pop: 8, ev: 17, archetype: "red" },
  { id: "GA", name: "Georgia", pop: 7, ev: 16, archetype: "swing" },
  { id: "NC", name: "North Carolina", pop: 7, ev: 16, archetype: "swing" },
  { id: "MI", name: "Michigan", pop: 7, ev: 15, archetype: "swing" },
  { id: "AZ", name: "Arizona", pop: 5, ev: 11, archetype: "swing" },
  { id: "WI", name: "Wisconsin", pop: 4, ev: 10, archetype: "swing" },
  { id: "MN", name: "Minnesota", pop: 4, ev: 10, archetype: "blue" },
  { id: "OK", name: "Oklahoma", pop: 3, ev: 7, archetype: "red" },
  { id: "KS", name: "Kansas", pop: 2, ev: 6, archetype: "red" },
];

const TOTAL_EV = STATES.reduce((acc, s) => acc + s.ev, 0);

// Per-archetype lean overrides — pushes group lean / turnout into the
// archetype. Blue states: urban tilts harder left, low-inc votes harder.
// Red states: rural tilts harder right, high-inc more dominant.

function demographicsForState(s: SimState): StateDemographics {
  const isBlue = s.archetype === "blue";
  const isRed = s.archetype === "red";
  const isSwing = s.archetype === "swing";

  const populationByGroup: Record<string, number> = {
    low_inc: isRed ? 28 : isBlue ? 35 : 30,
    mid_inc: 40,
    high_inc: isRed ? 32 : isBlue ? 25 : 30,
    urban: isBlue ? 50 : isRed ? 25 : 35,
    suburban: 35,
    rural: isBlue ? 15 : isRed ? 40 : 30,
  };

  const turnoutByGroup: Record<string, number> = {
    low_inc: 45,
    mid_inc: 60,
    high_inc: 75,
    urban: isBlue ? 60 : 50,
    suburban: 65,
    rural: isRed ? 65 : 55,
  };

  const leanShift = isBlue ? -1 : isRed ? +1 : 0;

  const groups: Record<string, StateDemographicGroup> = {};
  for (const cat of CATEGORIES) {
    for (const g of cat.groups) {
      groups[g.id] = {
        population: populationByGroup[g.id] ?? 33,
        turnout: turnoutByGroup[g.id] ?? 55,
        economicLean: g.defaultEconomicLean + leanShift,
        socialLean: g.defaultSocialLean + (isSwing ? 0 : leanShift),
      };
    }
  }

  return {
    _id: s.id,
    categoryWeights: { income: 50, geography: 50 },
    groups,
  } as unknown as StateDemographics;
}

// ─── Fixture: candidates ────────────────────────────────────────────────

interface SimCandidate {
  candidateId: string;
  characterName: string;
  party: string; // "DEM" | "REP" | "GRN" | etc.
  isNPP: boolean;
  charEP: number; // -4..+4
  charSP: number;
  partyEcon: number;
  partySocial: number;
  favorability: number;
  politicalInfluence: number;
  nationalInfluence: number;
  support: number;
  infamy?: number;
}

function toEnriched(c: SimCandidate): EnrichedCandidate {
  return {
    candidateId: c.candidateId,
    characterId: c.candidateId,
    characterName: c.characterName,
    party: c.party,
    isNPP: c.isNPP,
    charEP: c.charEP,
    charSP: c.charSP,
    favorability: c.favorability,
    politicalInfluence: c.politicalInfluence,
    nationalInfluence: c.nationalInfluence,
    support: c.support,
    infamy: c.infamy,
    partyEcon: c.partyEcon,
    partySocial: c.partySocial,
  };
}

// ─── Per-state Reg/Org by archetype ─────────────────────────────────────

interface PerStatePartyConfig {
  reg: number; // 0..100
  org: number; // 0..100
}

function partyOrgRegForState(s: SimState, party: string): PerStatePartyConfig {
  // Defaults: majors have substantial reg/org; tilt by archetype.
  const isBlue = s.archetype === "blue";
  const isRed = s.archetype === "red";

  if (party === "DEM") {
    if (isBlue) return { reg: 65, org: 75 };
    if (isRed) return { reg: 30, org: 35 };
    return { reg: 45, org: 50 }; // swing
  }
  if (party === "REP") {
    if (isRed) return { reg: 65, org: 75 };
    if (isBlue) return { reg: 25, org: 30 };
    return { reg: 45, org: 50 };
  }
  // Third party / NPP
  return { reg: 5, org: 10 };
}

// ─── Scenario runner: general election ──────────────────────────────────

interface GeneralResult {
  byState: Array<{
    stateId: string;
    name: string;
    ev: number;
    winner: string;
    shares: Record<string, number>;
    votes: Record<string, number>;
  }>;
  totalVotes: Record<string, number>;
  evByCandidate: Record<string, number>;
  evByParty: Record<string, number>;
}

interface GeneralScenario {
  label: string;
  candidates: SimCandidate[];
  // Optional overrides:
  fundsByParty?: Record<string, number>;
  incumbentSeatShareByParty?: Record<string, number>;
  presidentialModifierByParty?: Record<string, number>;
  // Optional per-state overrides on top of baseline Reg/Org:
  regOverride?: (state: SimState, party: string) => Partial<PerStatePartyConfig>;
}

function runGeneralScenario(sc: GeneralScenario): GeneralResult {
  const result: GeneralResult = {
    byState: [],
    totalVotes: {},
    evByCandidate: {},
    evByParty: {},
  };

  for (const c of sc.candidates) {
    result.totalVotes[c.candidateId] = 0;
    result.evByCandidate[c.candidateId] = 0;
    result.evByParty[c.party] = 0;
  }

  const enriched = sc.candidates.map(toEnriched);

  for (const state of STATES) {
    const demos = demographicsForState(state);

    // Build per-state Reg/Org maps with optional overrides.
    const partyOrgByParty = new Map<string, number>();
    const regByParty = new Map<string, number>();
    const seenParties = new Set<string>();
    for (const c of sc.candidates) {
      if (seenParties.has(c.party)) continue;
      seenParties.add(c.party);
      const base = partyOrgRegForState(state, c.party);
      const override = sc.regOverride?.(state, c.party) ?? {};
      const reg = override.reg ?? base.reg;
      const org = override.org ?? base.org;
      partyOrgByParty.set(c.party, org);
      regByParty.set(c.party, reg);
    }

    const fundsByParty = sc.fundsByParty
      ? new Map<string, number>(Object.entries(sc.fundsByParty))
      : undefined;
    const incumbentSeatShareByParty = sc.incumbentSeatShareByParty
      ? new Map<string, number>(Object.entries(sc.incumbentSeatShareByParty))
      : undefined;
    const presidentialModifierByParty = sc.presidentialModifierByParty
      ? new Map<string, number>(Object.entries(sc.presidentialModifierByParty))
      : undefined;

    // Total state turn pool — use ~60% turnout of population for a
    // single-shot tally (no per-turn accumulation here; we want full-cycle
    // totals for FPTP winner detection).
    const totalPool = Math.round(state.pop * 1_000_000 * 0.6);

    const options: DistributeVotesOptions = {
      useAveragedPositions: true,
      partyPositionWeight: 1, // 1:1 party/candidate
      usePresidentialPartyOrg: true,
      includeInfluenceInAppeal: true,
      useNationalInfluenceForReach: true,
      votingSystem: "fptp",
      isGeneralElection: true,
      countryId: "US",
      hasPlayerInRace: true,
      useOrgAwareSpoiler: true,
      regByParty,
      fundsByParty,
      incumbentSeatShareByParty,
      presidentialModifierByParty,
      useSwingFlowModel: true,
    };

    const { votesPerCandidate, sharesPct } = distributeVotesBySwingFlow(
      enriched,
      totalPool, // effectiveTurnPool — single-shot, all in this call
      totalPool, // totalPool
      state.pop * 1_000_000, // statePopulation
      demos,
      CATEGORIES,
      partyOrgByParty,
      options
    );

    // Determine winner by raw votes (FPTP — most votes wins state's EVs).
    let winnerId = "";
    let winnerVotes = -1;
    for (const cid of Object.keys(votesPerCandidate)) {
      if (votesPerCandidate[cid] > winnerVotes) {
        winnerVotes = votesPerCandidate[cid];
        winnerId = cid;
      }
    }

    const shares: Record<string, number> = {};
    for (const cid of Object.keys(sharesPct)) shares[cid] = sharesPct[cid];

    result.byState.push({
      stateId: state.id,
      name: state.name,
      ev: state.ev,
      winner: winnerId,
      shares,
      votes: { ...votesPerCandidate },
    });

    for (const cid of Object.keys(votesPerCandidate)) {
      result.totalVotes[cid] += votesPerCandidate[cid];
    }
    result.evByCandidate[winnerId] = (result.evByCandidate[winnerId] ?? 0) + state.ev;
    const winnerParty = sc.candidates.find((c) => c.candidateId === winnerId)?.party ?? "?";
    result.evByParty[winnerParty] = (result.evByParty[winnerParty] ?? 0) + state.ev;
  }

  return result;
}

// ─── Scenario runner: primary ──────────────────────────────────────────

interface PrimaryScenario {
  label: string;
  party: string;
  /** Party family — "dem" → all PR with 15% viability; "gop" → mixed PR/WTA per real-world default. */
  family: PrimaryCalendarFamily;
  candidates: SimCandidate[]; // all same party
  partyPosition: { economicPosition: number; socialPosition: number };
  states: string[]; // subset of STATES to run (primary wave)
  /** Default true. When false, candidate position is used directly (no party averaging). */
  useAveragedPositions?: boolean;
  /** Default true. When false, the general-electorate demographics are used as-is (no primary shift). */
  applyPrimaryShift?: boolean;
}

interface PrimaryResult {
  byState: Array<{
    stateId: string;
    name: string;
    winner: string;
    shares: Record<string, number>;
    votes: Record<string, number>;
    delegatesAvailable: number;
    allocationMethod: AllocationMethod;
    delegatesByCandidate: Record<string, number>;
    nonViable: string[];
  }>;
  totalVotes: Record<string, number>;
  totalShares: Record<string, number>;
  delegatesTotal: Record<string, number>;
  delegatesAwarded: number;
  delegatesAvailableNationwide: number;
}

function runPrimaryScenario(sc: PrimaryScenario): PrimaryResult {
  const result: PrimaryResult = {
    byState: [],
    totalVotes: {},
    totalShares: {},
    delegatesTotal: {},
    delegatesAwarded: 0,
    delegatesAvailableNationwide: 0,
  };
  for (const c of sc.candidates) {
    result.totalVotes[c.candidateId] = 0;
    result.delegatesTotal[c.candidateId] = 0;
  }

  const enriched = sc.candidates.map(toEnriched);

  for (const stateId of sc.states) {
    const state = STATES.find((s) => s.id === stateId);
    if (!state) continue;

    const baseDemos = demographicsForState(state);
    const primaryDemos =
      sc.applyPrimaryShift === false
        ? baseDemos
        : shiftDemographicsForPrimary(baseDemos, sc.partyPosition);

    const partyOrgByParty = new Map<string, number>();
    // Within a primary every candidate is same party — use party's state org.
    const orgForParty = partyOrgRegForState(state, sc.party).org;
    partyOrgByParty.set(sc.party, orgForParty);

    // Primary turnout ≈ 13% of general (matches PRIMARY_TURNOUT_FACTOR const).
    const totalPool = Math.round(state.pop * 1_000_000 * 0.6 * 0.13);

    const options: DistributeVotesOptions = {
      useAveragedPositions: sc.useAveragedPositions ?? true,
      partyPositionWeight: 1,
      usePresidentialPartyOrg: true,
      includeInfluenceInAppeal: true,
      useNationalInfluenceForReach: true,
      presidentialPrimaryNationalReach: true,
      votingSystem: "fptp",
      isGeneralElection: false, // primary — no Reg/swing
      countryId: "US",
      hasPlayerInRace: true,
      useSwingFlowModel: false, // primaries don't use swing-flow
    };

    // Note: swing-flow only fires on general (Step 1 short-circuits when
    // totalPool ≤ 0 but otherwise we always run the full pipeline; the
    // swing layer adds zero swing when regByParty is undefined and only
    // one party is in the race because there are no party pairs to swing
    // between).
    const { votesPerCandidate, sharesPct } = distributeVotesBySwingFlow(
      enriched,
      totalPool,
      totalPool,
      state.pop * 1_000_000,
      primaryDemos,
      CATEGORIES,
      partyOrgByParty,
      options
    );

    let winnerId = "";
    let winnerVotes = -1;
    for (const cid of Object.keys(votesPerCandidate)) {
      if (votesPerCandidate[cid] > winnerVotes) {
        winnerVotes = votesPerCandidate[cid];
        winnerId = cid;
      }
    }

    // ── Delegate allocation ────────────────────────────────────────────
    // Game uses real 2020 delegate counts per state per party family, and
    // the per-state chair pick (PR vs WTA, fallback to family default).
    // We don't model chair overrides here — fall back to the default.
    const delegatesAvailable = getDelegatesForState(state.id, sc.family);
    const allocationMethod = getDefaultPrimaryAllocation(state.id, sc.family);
    const alloc = allocateDelegates(allocationMethod, votesPerCandidate, delegatesAvailable);

    result.byState.push({
      stateId: state.id,
      name: state.name,
      winner: winnerId,
      shares: { ...sharesPct },
      votes: { ...votesPerCandidate },
      delegatesAvailable,
      allocationMethod,
      delegatesByCandidate: alloc.byCandidate,
      nonViable: alloc.nonViable,
    });

    for (const cid of Object.keys(votesPerCandidate)) {
      result.totalVotes[cid] += votesPerCandidate[cid];
    }
    for (const cid of Object.keys(alloc.byCandidate)) {
      result.delegatesTotal[cid] = (result.delegatesTotal[cid] ?? 0) + alloc.byCandidate[cid];
    }
    result.delegatesAwarded += alloc.totalAwarded;
    result.delegatesAvailableNationwide += delegatesAvailable;
  }

  const totalAll = Object.values(result.totalVotes).reduce((a, b) => a + b, 0);
  for (const cid of Object.keys(result.totalVotes)) {
    result.totalShares[cid] = totalAll > 0 ? (result.totalVotes[cid] / totalAll) * 100 : 0;
  }

  return result;
}

// ─── Formatting helpers ────────────────────────────────────────────────

const PCT = (v: number) => `${v.toFixed(1)}%`;
const N = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function printGeneralResult(label: string, sc: GeneralScenario, r: GeneralResult): void {
  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`  ${label}`);
  console.log(`══════════════════════════════════════════════════════════════`);

  const cands = sc.candidates;

  // Per-state breakdown
  console.log(
    `\n  ${pad("State", 16)}  ${pad("EV", 4)}  ${cands
      .map((c) => pad(c.characterName.split(" ")[0]!, 9))
      .join(" ")}  Winner`
  );
  console.log(`  ${"─".repeat(16 + 4 + cands.length * 10 + 8)}`);
  for (const row of r.byState) {
    const winnerName =
      cands.find((c) => c.candidateId === row.winner)?.characterName.split(" ")[0] ?? "?";
    console.log(
      `  ${pad(row.name, 16)}  ${pad(String(row.ev), 4)}  ${cands
        .map((c) => pad(PCT(row.shares[c.candidateId] ?? 0), 9))
        .join(" ")}  ${winnerName}`
    );
  }

  console.log(`\n  Electoral Votes`);
  console.log(`  ──────────────────────`);
  const totalVotesAll = Object.values(r.totalVotes).reduce((a, b) => a + b, 0);
  for (const c of cands) {
    const ev = r.evByCandidate[c.candidateId] ?? 0;
    const npv = r.totalVotes[c.candidateId] ?? 0;
    const npvPct = totalVotesAll > 0 ? (npv / totalVotesAll) * 100 : 0;
    console.log(
      `  ${pad(c.characterName, 22)}  ${pad(`${c.party}`, 5)}  EV: ${pad(String(ev), 3)}/${TOTAL_EV}    PV: ${pad(N(npv), 12)} (${PCT(npvPct)})`
    );
  }
  const needed = Math.floor(TOTAL_EV / 2) + 1;
  const winners = Object.entries(r.evByCandidate)
    .filter(([, ev]) => ev >= needed)
    .map(([cid]) => cands.find((c) => c.candidateId === cid)?.characterName ?? cid);
  console.log(
    `  Threshold for win: ${needed} EV  →  ${winners.length > 0 ? `WINNER: ${winners.join(", ")}` : "NO MAJORITY"}`
  );
}

function printPrimaryResult(label: string, sc: PrimaryScenario, r: PrimaryResult): void {
  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`  ${label}`);
  console.log(`══════════════════════════════════════════════════════════════`);

  const cands = sc.candidates;

  // Per-state breakdown with vote % AND delegates per candidate per state.
  console.log(
    `\n  ${pad("State", 16)} ${pad("Del", 4)} ${pad("Rule", 5)}  ${cands
      .map((c) => pad(c.characterName.split(" ")[0]!, 14))
      .join(" ")}`
  );
  console.log(`  ${"─".repeat(16 + 4 + 5 + cands.length * 15 + 4)}`);
  for (const row of r.byState) {
    const cells = cands.map((c) => {
      const pct = PCT(row.shares[c.candidateId] ?? 0);
      const dels = row.delegatesByCandidate[c.candidateId] ?? 0;
      const nv = row.nonViable.includes(c.candidateId) ? "*" : "";
      return pad(`${pct} (${dels}${nv})`, 14);
    });
    console.log(
      `  ${pad(row.name, 16)} ${pad(String(row.delegatesAvailable), 4)} ${pad(row.allocationMethod, 5)}  ${cells.join(" ")}`
    );
  }
  console.log(`  (* = below 15% PR viability, awarded 0 delegates)`);

  // National totals.
  console.log(`\n  National Primary Totals (sim-states only)`);
  console.log(`  ──────────────────────────────────────────`);
  for (const c of cands) {
    const sh = r.totalShares[c.candidateId] ?? 0;
    const dels = r.delegatesTotal[c.candidateId] ?? 0;
    const delShare = r.delegatesAwarded > 0 ? (dels / r.delegatesAwarded) * 100 : 0;
    console.log(
      `  ${pad(c.characterName, 22)}  ${pad(c.party, 4)}  PV: ${pad(PCT(sh), 6)}  Del: ${pad(String(dels), 4)} (${PCT(delShare)})  pos: (${c.charEP},${c.charSP}) sup=${c.support}`
    );
  }

  // Delegate winner + national context.
  const familyTotal = getTotalDelegatesForFamily(sc.family);
  const majority = getDelegateMajority(sc.family);
  const ranked = [...Object.entries(r.delegatesTotal)].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const topName = top
    ? (cands.find((c) => c.candidateId === top[0])?.characterName ?? top[0])
    : "?";
  const popularLeader = [...Object.entries(r.totalVotes)].sort((a, b) => b[1] - a[1])[0];
  const popularName = popularLeader
    ? (cands.find((c) => c.candidateId === popularLeader[0])?.characterName ?? popularLeader[0])
    : "?";

  console.log(
    `  ${pad("─", 70)}\n  Delegate leader: ${topName} (${top?.[1] ?? 0} of ${r.delegatesAwarded} awarded across ${r.byState.length} states)\n  Family total nationwide: ${familyTotal} delegates  /  majority needed: ${majority}\n  Popular-vote leader: ${popularName}${topName !== popularName ? "  ⚠ disagrees with delegate leader" : ""}`
  );
}

// ─── Scenarios ──────────────────────────────────────────────────────────

const DEM_BASE: SimCandidate = {
  candidateId: "dem1",
  characterName: "Dem Candidate",
  party: "DEM",
  isNPP: false,
  charEP: -2,
  charSP: -2,
  partyEcon: -2,
  partySocial: -2,
  favorability: 55,
  politicalInfluence: 70,
  nationalInfluence: 70,
  support: 50,
};

const REP_BASE: SimCandidate = {
  candidateId: "rep1",
  characterName: "Rep Candidate",
  party: "REP",
  isNPP: false,
  charEP: 2,
  charSP: 2,
  partyEcon: 2,
  partySocial: 2,
  favorability: 55,
  politicalInfluence: 70,
  nationalInfluence: 70,
  support: 50,
};

const SCENARIOS_G: GeneralScenario[] = [
  {
    label: "G1: Baseline two-party general (incumbent Dem vs challenger Rep)",
    candidates: [{ ...DEM_BASE }, { ...REP_BASE }],
    incumbentSeatShareByParty: { DEM: 1, REP: 0 },
  },
  {
    label: "G2: Dem 5× funds advantage (money driver test)",
    candidates: [{ ...DEM_BASE }, { ...REP_BASE }],
    fundsByParty: { DEM: 50_000_000, REP: 10_000_000 },
    incumbentSeatShareByParty: { DEM: 1, REP: 0 },
  },
  {
    label: "G3: Support polarization (Dem support=80, Rep support=30)",
    candidates: [
      { ...DEM_BASE, support: 80 },
      { ...REP_BASE, support: 30 },
    ],
    incumbentSeatShareByParty: { DEM: 1, REP: 0 },
  },
  {
    label: "G4: Three-way FPTP — Dem, Rep, and a Green NPP at (+1,-2)",
    candidates: [
      { ...DEM_BASE },
      { ...REP_BASE },
      {
        candidateId: "grn1",
        characterName: "Green NPP",
        party: "GRN",
        isNPP: true,
        charEP: 1,
        charSP: -2,
        partyEcon: 1,
        partySocial: -2,
        favorability: 50,
        politicalInfluence: 50,
        nationalInfluence: 45,
        support: 50,
      },
    ],
    incumbentSeatShareByParty: { DEM: 1, REP: 0 },
  },
  {
    label: "G5: High-Reg Rep incumbent (80) vs low-Reg Dem challenger (20) — entrenchment test",
    candidates: [{ ...DEM_BASE }, { ...REP_BASE }],
    regOverride: (_state, party) => {
      if (party === "DEM") return { reg: 20 };
      if (party === "REP") return { reg: 80 };
      return {};
    },
    incumbentSeatShareByParty: { DEM: 0, REP: 1 },
  },
  {
    label: "G5b: Isolated Reg — Rep Reg=80, Dem Reg=20, BUT Dem incumbent",
    candidates: [{ ...DEM_BASE }, { ...REP_BASE }],
    regOverride: (_state, party) => {
      if (party === "DEM") return { reg: 20 };
      if (party === "REP") return { reg: 80 };
      return {};
    },
    incumbentSeatShareByParty: { DEM: 1, REP: 0 },
  },
  {
    label: "G6: Rep incumbent defender (seat share 1.0) — incumbency driver",
    candidates: [{ ...DEM_BASE }, { ...REP_BASE }],
    incumbentSeatShareByParty: { DEM: 0, REP: 1 },
  },
];

// Dem primary — three candidates: centrist, moderate, extreme.
const DEM_PRIMARY_SCENARIO: PrimaryScenario = {
  label: "P1: Dem presidential primary — centrist vs moderate vs progressive",
  party: "DEM",
  family: "dem",
  partyPosition: { economicPosition: -2, socialPosition: -2 },
  states: ["IA", "NH", "CA", "TX", "PA", "GA", "FL", "MI"].filter((id) =>
    STATES.some((s) => s.id === id)
  ),
  candidates: [
    {
      candidateId: "dem_centrist",
      characterName: "Centrist Dem",
      party: "DEM",
      isNPP: false,
      charEP: -1,
      charSP: -1,
      partyEcon: -2,
      partySocial: -2,
      favorability: 55,
      politicalInfluence: 60,
      nationalInfluence: 55,
      support: 50,
    },
    {
      candidateId: "dem_moderate",
      characterName: "Moderate Dem",
      party: "DEM",
      isNPP: false,
      charEP: -2,
      charSP: -2,
      partyEcon: -2,
      partySocial: -2,
      favorability: 60,
      politicalInfluence: 70,
      nationalInfluence: 65,
      support: 50,
    },
    {
      candidateId: "dem_progressive",
      characterName: "Progressive Dem",
      party: "DEM",
      isNPP: false,
      charEP: -4,
      charSP: -3,
      partyEcon: -2,
      partySocial: -2,
      favorability: 50,
      politicalInfluence: 55,
      nationalInfluence: 60,
      support: 60,
    },
  ],
};

const REP_PRIMARY_SCENARIO: PrimaryScenario = {
  label: "P2: Rep presidential primary — moderate vs conservative vs hard-right",
  party: "REP",
  family: "gop",
  partyPosition: { economicPosition: 2, socialPosition: 2 },
  states: ["IA", "NH", "TX", "FL", "GA", "OH", "OK", "KS"].filter((id) =>
    STATES.some((s) => s.id === id)
  ),
  candidates: [
    {
      candidateId: "rep_moderate",
      characterName: "Moderate Rep",
      party: "REP",
      isNPP: false,
      charEP: 1,
      charSP: 1,
      partyEcon: 2,
      partySocial: 2,
      favorability: 55,
      politicalInfluence: 65,
      nationalInfluence: 60,
      support: 50,
    },
    {
      candidateId: "rep_conservative",
      characterName: "Conservative Rep",
      party: "REP",
      isNPP: false,
      charEP: 3,
      charSP: 3,
      partyEcon: 2,
      partySocial: 2,
      favorability: 60,
      politicalInfluence: 70,
      nationalInfluence: 70,
      support: 55,
    },
    {
      candidateId: "rep_hardright",
      characterName: "Hard-Right Rep",
      party: "REP",
      isNPP: false,
      charEP: 4,
      charSP: 4,
      partyEcon: 2,
      partySocial: 2,
      favorability: 45,
      politicalInfluence: 50,
      nationalInfluence: 55,
      support: 60,
    },
  ],
};

// ─── P3: Support vs PI tradeoff ─────────────────────────────────────────
// Insurgent (high Support, low PI) vs Establishment (high PI, neutral
// Support). Tests whether late-cycle Support gains can overcome a
// candidate quality / name-recognition gap.

const DEM_PRIMARY_INSURGENT_VS_ESTABLISHMENT: PrimaryScenario = {
  label: "P3: Insurgent Support=85 (PI=55) vs Establishment Support=50 (PI=80)",
  party: "DEM",
  family: "dem",
  partyPosition: { economicPosition: -2, socialPosition: -2 },
  states: ["MN", "PA", "CA", "NY", "GA", "MI"],
  candidates: [
    {
      candidateId: "dem_insurgent",
      characterName: "Insurgent Dem",
      party: "DEM",
      isNPP: false,
      charEP: -2,
      charSP: -2,
      partyEcon: -2,
      partySocial: -2,
      favorability: 50,
      politicalInfluence: 55,
      nationalInfluence: 55,
      support: 85,
    },
    {
      candidateId: "dem_establishment",
      characterName: "Establishment Dem",
      party: "DEM",
      isNPP: false,
      charEP: -2,
      charSP: -2,
      partyEcon: -2,
      partySocial: -2,
      favorability: 60,
      politicalInfluence: 80,
      nationalInfluence: 80,
      support: 50,
    },
  ],
};

// ─── P4: Crowded 5-way field ────────────────────────────────────────────
// Tests fragmentation behavior — does one candidate consolidate
// disproportionately, or does the vote spread reasonably?

const DEM_PRIMARY_CROWDED: PrimaryScenario = {
  label: "P4: Crowded Dem primary — 5 candidates spread across position space",
  party: "DEM",
  family: "dem",
  partyPosition: { economicPosition: -2, socialPosition: -2 },
  states: ["MN", "PA", "CA", "NY", "GA", "MI"],
  candidates: [
    {
      candidateId: "dem_c1",
      characterName: "Centrist Joe",
      party: "DEM",
      isNPP: false,
      charEP: 0,
      charSP: -1,
      partyEcon: -2,
      partySocial: -2,
      favorability: 55,
      politicalInfluence: 65,
      nationalInfluence: 60,
      support: 50,
    },
    {
      candidateId: "dem_c2",
      characterName: "Moderate Jane",
      party: "DEM",
      isNPP: false,
      charEP: -1,
      charSP: -2,
      partyEcon: -2,
      partySocial: -2,
      favorability: 60,
      politicalInfluence: 70,
      nationalInfluence: 65,
      support: 55,
    },
    {
      candidateId: "dem_c3",
      characterName: "Progressive Sam",
      party: "DEM",
      isNPP: false,
      charEP: -3,
      charSP: -2,
      partyEcon: -2,
      partySocial: -2,
      favorability: 55,
      politicalInfluence: 60,
      nationalInfluence: 60,
      support: 60,
    },
    {
      candidateId: "dem_c4",
      characterName: "Far-Left Ari",
      party: "DEM",
      isNPP: false,
      charEP: -4,
      charSP: -3,
      partyEcon: -2,
      partySocial: -2,
      favorability: 45,
      politicalInfluence: 50,
      nationalInfluence: 55,
      support: 65,
    },
    {
      candidateId: "dem_c5",
      characterName: "Niche Kim",
      party: "DEM",
      isNPP: false,
      charEP: -2,
      charSP: -4,
      partyEcon: -2,
      partySocial: -2,
      favorability: 50,
      politicalInfluence: 45,
      nationalInfluence: 50,
      support: 55,
    },
  ],
};

// ─── P5: Primary shift impact (shifted vs unshifted) ────────────────────
// Runs identical Dem field twice: once with shiftDemographicsForPrimary
// applied (real behavior), once without (general electorate as control).
// Delta exposes how much the primary-voter scaling moves outcomes.

const DEM_PRIMARY_BASELINE: PrimaryScenario = {
  label: "P5a: Dem primary — WITH primary electorate shift (default)",
  party: "DEM",
  family: "dem",
  partyPosition: { economicPosition: -2, socialPosition: -2 },
  states: ["MN", "PA", "CA", "NY", "GA", "MI"],
  applyPrimaryShift: true,
  candidates: [
    {
      candidateId: "p5_centrist",
      characterName: "Centrist Dem",
      party: "DEM",
      isNPP: false,
      charEP: -1,
      charSP: -1,
      partyEcon: -2,
      partySocial: -2,
      favorability: 55,
      politicalInfluence: 65,
      nationalInfluence: 60,
      support: 50,
    },
    {
      candidateId: "p5_progressive",
      characterName: "Progressive Dem",
      party: "DEM",
      isNPP: false,
      charEP: -4,
      charSP: -3,
      partyEcon: -2,
      partySocial: -2,
      favorability: 55,
      politicalInfluence: 65,
      nationalInfluence: 60,
      support: 50,
    },
  ],
};

const DEM_PRIMARY_UNSHIFTED: PrimaryScenario = {
  ...DEM_PRIMARY_BASELINE,
  label: "P5b: Same field — WITHOUT primary electorate shift (general-style control)",
  applyPrimaryShift: false,
};

// ─── P6: Pure ideological probe ─────────────────────────────────────────
// Three Dem candidates with identical PI / favorability / support; only
// position differs. Tests whether the primary electorate actually
// rewards party-aligned ideology when other factors are flat.
// Disables party-position averaging so candidate position is the only
// remaining lever.

const DEM_PRIMARY_PURE_IDEOLOGY: PrimaryScenario = {
  label: "P6: Pure ideology — identical PI/support/fav, only position differs (no party averaging)",
  party: "DEM",
  family: "dem",
  partyPosition: { economicPosition: -2, socialPosition: -2 },
  states: ["MN", "PA", "CA", "NY", "GA", "MI"],
  useAveragedPositions: false,
  candidates: [
    {
      candidateId: "pure_centrist",
      characterName: "Centrist (-1,-1)",
      party: "DEM",
      isNPP: false,
      charEP: -1,
      charSP: -1,
      partyEcon: -2,
      partySocial: -2,
      favorability: 55,
      politicalInfluence: 65,
      nationalInfluence: 60,
      support: 50,
    },
    {
      candidateId: "pure_aligned",
      characterName: "Aligned (-2,-2)",
      party: "DEM",
      isNPP: false,
      charEP: -2,
      charSP: -2,
      partyEcon: -2,
      partySocial: -2,
      favorability: 55,
      politicalInfluence: 65,
      nationalInfluence: 60,
      support: 50,
    },
    {
      candidateId: "pure_progressive",
      characterName: "Progressive (-4,-3)",
      party: "DEM",
      isNPP: false,
      charEP: -4,
      charSP: -3,
      partyEcon: -2,
      partySocial: -2,
      favorability: 55,
      politicalInfluence: 65,
      nationalInfluence: 60,
      support: 50,
    },
  ],
};

// ─── Driver: run everything + print findings ───────────────────────────

function main(): void {
  // Note: IA / NH are not in our STATES fixture (we only modeled 15 EV-
  // weighted states). Use first two by archetype for "early primary" flavor.
  // Re-route primaries to start with WI (small swing) and OK (small red).
  DEM_PRIMARY_SCENARIO.states = ["MN", "PA", "CA", "NY", "GA", "MI"];
  REP_PRIMARY_SCENARIO.states = ["KS", "OK", "TX", "FL", "OH", "NC"];

  console.log(
    `\n  Simulating §7.3.2 swing-flow presidential engine across ${STATES.length} synthetic states (${TOTAL_EV} EV).\n`
  );

  // Sanity warm-up: turnVoteWeight invariant — sum across all turns = totalPool.
  const TURNS = 24;
  const POOL = 10_000_000;
  let sum = 0;
  for (let i = 0; i < TURNS; i++) sum += turnVoteWeight(TURNS, i, POOL);
  console.log(
    `  turnVoteWeight sanity: ${TURNS} turns, pool=${N(POOL)} → cumulative=${N(sum)} (expected ${N(POOL)})`
  );
  console.log(
    `  supportMoodMultiplier sanity: 0=${supportMoodMultiplier(0).toFixed(2)}, 50=${supportMoodMultiplier(50).toFixed(2)}, 80=${supportMoodMultiplier(80).toFixed(2)}, 100=${supportMoodMultiplier(100).toFixed(2)}`
  );

  // GENERAL SCENARIOS
  for (const sc of SCENARIOS_G) {
    const r = runGeneralScenario(sc);
    printGeneralResult(sc.label, sc, r);
  }

  // PRIMARIES
  const primaryScenarios: PrimaryScenario[] = [
    DEM_PRIMARY_SCENARIO,
    REP_PRIMARY_SCENARIO,
    DEM_PRIMARY_INSURGENT_VS_ESTABLISHMENT,
    DEM_PRIMARY_CROWDED,
    DEM_PRIMARY_BASELINE,
    DEM_PRIMARY_UNSHIFTED,
    DEM_PRIMARY_PURE_IDEOLOGY,
  ];
  for (const sc of primaryScenarios) {
    const r = runPrimaryScenario(sc);
    printPrimaryResult(sc.label, sc, r);
  }

  console.log(`\n  Done.\n`);
}

main();
