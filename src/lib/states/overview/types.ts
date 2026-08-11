/**
 * Shared types for the State Overview tab (Phase 1).
 *
 * These types are consumed by:
 *   - getStateOverview() — server-side aggregator (server component path)
 *   - buildOverviewViewModel() — pure view-model builder
 *   - the Overview tab orchestrator + leaf components
 *
 * See plan §"Phase 1 — State Overview Tab" and design doc
 * docs/design/political-system-reg-support.md.
 */

import type { CountryId } from "@/lib/constants/countries";
import type { RegionalExecutive } from "@/lib/states/regionalExecutive";

/** A single party's contribution to a state's Org / Reg pools. */
export interface PartyOrgRow {
  /** PoliticalParty._id stringified. */
  id: string;
  abbr: string;
  /** Hex color for UI rendering. */
  color: string;
  /** Org%, 0..100. */
  orgPct: number;
  /** Reg%, 0..100; may be 0 / placeholder until Phase 1.5/2 backfill. */
  regPct: number;
}

/** Source classification for the Reg% KPI.
 *  - "field": a real `StatePartyOrg.registration` value (Phase 1.5/2+).
 *  - "derived": no real value; UI must surface a placeholder. */
export type RegSource = "field" | "derived";

export interface OverviewKpis {
  /** Top party's Org%. */
  topPartyOrgPct: number;
  /** PoliticalParty._id of the top party (by Org). */
  topPartyId: string;
  /** Top party's Reg%. 0 when no real value (regSource === "derived"). */
  topPartyRegPct: number;
  /** Whether the Reg% number is from a real field or a placeholder. */
  regSource: RegSource;
  /** State GDP — direct read from State.gdp. */
  gdp: number;
  /** Count of hot + lean races in this state's current cycle. */
  competitiveRacesCount: number;
}

/** Summary row for the Race Watchlist card. */
export interface HotRaceSummary {
  electionId: string;
  electionType:
    | "senate"
    | "house"
    | "governor"
    | "stateSenate"
    | "stateExec"
    | "presidential"
    | "commons"
    | "regionalCouncil"
    | "shugiin"
    | "sangiin"
    | "bundestag"
    | (string & {});
  /**
   * Numeric district label only ("7", "12", ...) parsed from the trailing
   * digits of `seatId`. Undefined when the seat carries no number — the
   * UI then renders the bare race-type label (e.g. "House") rather than a
   * raw seatId string.
   */
  district?: string;
  /** US-senate only: senate class (I/II/III) — surfaces in the label. */
  senateClass?: number;
  status: "hot" | "lean" | "safe";
  incumbent?: { name: string; partyId: string };
  /** Top-two margin in percentage points of vote share (general-phase only). */
  topTwoMargin: number;
  url: string;
}

/**
 * Summary row for the Contested Primaries card. Surfaces any primary
 * (state or national) currently in its primary phase where a single party
 * has 2+ active candidates competing for the slot. One entry per
 * (election × party) pair — a single race can produce multiple rows if
 * both major parties have contested primaries.
 */
export interface ContestedPrimarySummary {
  electionId: string;
  electionType:
    | "senate"
    | "house"
    | "governor"
    | "stateSenate"
    | "stateExec"
    | "presidential"
    | "commons"
    | "regionalCouncil"
    | "shugiin"
    | "sangiin"
    | "bundestag"
    | (string & {});
  /** Numeric district label parsed from the trailing digits of `seatId`. */
  district?: string;
  /** US-senate only: senate class (I/II/III). */
  senateClass?: number;
  /** sequentialId-string of the contested party. */
  partyId: string;
  partyAbbr: string;
  partyColor: string;
  /** Number of active candidates from `partyId` in this primary. */
  candidateCount: number;
  url: string;
}

/** Summary for the Economy Summary card. */
export interface EconomySummary {
  gdp: number;
  /** Recent GDP delta as a percentage; placeholder 0 until trend data wired. */
  gdpDeltaPct: number;
  /**
   * Top-N sectors in the state by aggregate corporate-sector revenue,
   * recomputed once per turn into `State.topSectorsCache`. When the
   * cache is empty (no corp activity yet, or fresh-reset world), this
   * falls back to the state's seed specializations (primary +
   * secondary) so the card always has something to show.
   *
   * `specializationBonus` flags entries that match the state's seed
   * `sectorSpecializations` — `"primary"` carries the +10pp regional
   * margin bonus, `"secondary"` carries +5pp.
   */
  topSectors: Array<{
    id: string;
    share: number;
    specializationBonus: "primary" | "secondary" | null;
  }>;
  /** Unemployment rate (0..100). 0 when not yet wired. */
  unemployment: number;
}

export interface StateOverviewResult {
  stateId: string;
  countryId: CountryId;
  kpis: OverviewKpis;
  /** Sorted by orgPct descending. Includes parties with 0 Org but at least
   *  a `StatePartyOrg` row in this state. */
  partyOrg: PartyOrgRow[];
  /** 100 - sum of partyOrg[*].orgPct, clamped to 0. */
  unaffiliatedPct: number;
  /**
   * Registration pool composition for this state. `parties` are per-party
   * Reg% shares; `independent` and `unregistered` are state-level
   * non-party buckets. Sum equals 100 once seeded; before seed, all values
   * are 0 and the UI surfaces a placeholder.
   *
   * See design doc §4 (Registration storage + state-level pools).
   */
  registrationPool: {
    parties: Array<{ id: string; abbr: string; color: string; regPct: number }>;
    independent: number;
    unregistered: number;
    /** True once at least one party has a real Reg value in this state. */
    seeded: boolean;
  };
  regionalExecutive: RegionalExecutive | null;
  hotRaces: HotRaceSummary[];
  /**
   * Primary races in this state currently in their primary phase where a
   * single party fields 2+ active candidates. Empty list when nothing is
   * contested. Replaces the legacy `primaryContest` single-value field.
   */
  contestedPrimaries: ContestedPrimarySummary[];
  economy: EconomySummary;
}

/**
 * The view-model presented to the Overview tab leaf components. Adds
 * presentation-derived fields on top of `StateOverviewResult`:
 *   - which party slice the donut chart highlights / "explodes"
 *   - that party's color and abbreviation, surfaced once for cheap reads
 *   - a narrative tuple (rank, gap-to-#1) for the Political Summary card
 *   - simple flags for whether CTAs are clickable in this view
 *
 * Built by `buildOverviewViewModel(result, { viewerPartyId })`.
 */
export interface OverviewViewModel extends StateOverviewResult {
  /** PartyId of the slice the pie focuses on. Falls back to leading party. */
  pieFocusPartyId: string;
  /** Color of the focused party (hex). */
  focusPartyColor: string;
  /** Abbreviation of the focused party. */
  focusPartyAbbr: string;
  /**
   * Org% of the focused party (0..100). This is the focus party's OWN
   * share — not the leader's. The donut center pairs `focusPartyAbbr`
   * with this so a non-leading viewer (e.g. RFP) sees their own number,
   * not the leading party's `kpis.topPartyOrgPct`.
   */
  focusPartyOrgPct: number;
  /** Narrative summary used by `PoliticalSummaryCard`. */
  narrative: NarrativeSummary;
}

/** Narrative summary tuple for the Political Summary card. */
export interface NarrativeSummary {
  /** Rank of the focus party (1 = leader). */
  rank: number;
  /** Total parties with rows in this state. */
  totalParties: number;
  /** Org-percent gap between focus party and #1 (0 if focus is the leader). */
  gapToTop: number;
}
