import type { StatePartyOrg } from "@/lib/db/types";
import { states } from "./states";
import { isUsElectoralState } from "@/lib/constants/states";
import { isUsPoliticalState } from "@/lib/elections/statehoodAdmission";
import { ELECTION_2020_MARGIN, marginToLean } from "@/lib/data/2020ElectionResults";
import { ELECTION_1988_MARGIN } from "@/lib/data/1988ElectionResults";
import { ELECTION_1980_MARGIN } from "@/lib/data/1980ElectionResults";
import { ELECTION_2000_MARGIN } from "@/lib/data/2000ElectionResults";
import { ELECTION_2008_MARGIN } from "@/lib/data/2008ElectionResults";
import { ELECTION_2024_MARGIN } from "@/lib/data/2024ElectionResults";
import { ELECTION_1952_MARGIN } from "@/lib/data/1952ElectionResults";

/**
 * Per-preset presidential-margin baseline. Each reset era anchors its initial
 * state lean (and therefore initial party Org) to the presidential election
 * nearest the era's start:
 *
 *   1953-default → 1952 (Stevenson v Eisenhower)
 *   1979-default → 1980 (Carter v Reagan)
 *   1991-default → 1988 (Dukakis v Bush)
 *   1999-default → 2000 (Gore v Bush)
 *   2007-default → 2008 (Obama v McCain)
 *   2019-default → 2020 (Biden v Trump)
 *   2023-default → 2024 (Harris v Trump)
 *
 * Keep this map in sync with `ELECTION_BASELINES` in
 * `src/lib/seeds/calibration/electionBaselines.ts`, which the seed-readiness
 * audit uses to score derived leans against the same election.
 */
const PRESET_MARGINS: Record<string, Record<string, number>> = {
  // NOTE: for 1953 the initial Org from these margins is subsequently
  // overwritten by `seedRegistrationLanes` (registrationLanes1953 curates
  // per-state lanes), so this entry mainly keeps the lean fallback and the
  // seed-readiness election baseline era-correct instead of 2020-shaped.
  "1953-default": ELECTION_1952_MARGIN,
  "1979-default": ELECTION_1980_MARGIN,
  "1991-default": ELECTION_1988_MARGIN,
  "1999-default": ELECTION_2000_MARGIN,
  "2007-default": ELECTION_2008_MARGIN,
  "2019-default": ELECTION_2020_MARGIN,
  "2023-default": ELECTION_2024_MARGIN,
};

/**
 * Select the presidential-margin baseline for a given reset preset.
 * Unknown presets fall back to 2020 (the original behavior).
 */
export function marginsForPreset(presetId: string): Record<string, number> {
  return PRESET_MARGINS[presetId] ?? ELECTION_2020_MARGIN;
}

/** Derive lean from a margins table. Positive lean = red, negative = blue. */
function stateLean(stateId: string, margins: Record<string, number>): number {
  const margin = margins[stateId];
  return margin !== undefined ? marginToLean(margin) : 0;
}

// Constants for organization calculations
const BASELINE_ORG = 25;
const ORG_BONUS_PER_LEAN = 7;

// US major party sequentialIds (assigned during seed: democrat=1, republican=2)
const DEMOCRAT_SEQ_ID = "1";
const REPUBLICAN_SEQ_ID = "2";

/**
 * Calculate initial party org from state political lean (non-zero-sum).
 * Each party has a baseline presence plus bonus in favorable states.
 *
 * Range: 25 (baseline-only) to 60 (max lean bonus). No per-party cap —
 * the state-wide Org pool sum constraint (Σ party Org + Unaffiliated Org
 * = 100) is the only upper bound, enforced elsewhere.
 *
 * @param politicalLean - State's political lean (-5 to +5)
 * @param partySeqId - Party sequentialId string
 * @returns Initial organization value
 */
function calculateInitialOrg(politicalLean: number, partySeqId: string): number {
  let org = BASELINE_ORG;

  if (partySeqId === DEMOCRAT_SEQ_ID) {
    // Democrats get bonus in blue states (negative lean)
    org += Math.max(0, -politicalLean) * ORG_BONUS_PER_LEAN;
  } else if (partySeqId === REPUBLICAN_SEQ_ID) {
    // Republicans get bonus in red states (positive lean)
    org += Math.max(0, politicalLean) * ORG_BONUS_PER_LEAN;
  } else {
    // Third parties start at 0
    return 0;
  }

  return org;
}

/**
 * Generate StatePartyOrg entries for all states and major parties for a
 * given reset preset. The preset selects the presidential-margin baseline
 * used to compute state lean (and therefore initial Org). After this seed
 * runs, `seedRegistrationLanes` overwrites `organization` (and sets
 * `registration`) per the preset's curated lane templates.
 *
 * Pre-statehood territories (Alaska/Hawaii under `1953-default`) are omitted —
 * they join via {@link buildMajorPartyOrgsForState} when admitted mid-game.
 */
export function generateStatePartyOrg(
  presetId: string = "2019-default"
): Omit<StatePartyOrg, "createdAt" | "updatedAt">[] {
  const margins = marginsForPreset(presetId);
  const entries: Omit<StatePartyOrg, "createdAt" | "updatedAt">[] = [];

  for (const state of states) {
    // Federal districts like DC, and pre-statehood territories for this era,
    // elect no offices and host no state party organization until admitted.
    if (!isUsPoliticalState(state._id, presetId)) continue;
    entries.push(...buildMajorPartyOrgsForState(state._id, presetId, margins));
  }

  return entries;
}

/**
 * Dem + Rep `statePartyOrg` rows for one state. Used by the seed sweep and by
 * statehood admission when a territory joins the Union mid-game.
 */
export function buildMajorPartyOrgsForState(
  stateId: string,
  presetId: string = "2019-default",
  margins: Record<string, number> = marginsForPreset(presetId)
): Omit<StatePartyOrg, "createdAt" | "updatedAt">[] {
  if (!isUsElectoralState(stateId)) return [];
  const lean = stateLean(stateId, margins);
  const partySeqIds = [DEMOCRAT_SEQ_ID, REPUBLICAN_SEQ_ID];
  return partySeqIds.map((partyId) => ({
    _id: `${stateId}_${partyId}`,
    countryId: "US" as const,
    stateId,
    partyId,
    organization: calculateInitialOrg(lean, partyId),
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    treasury: 0,
    stateTaxRate: 0,
    politicalStrength: 0,
    hasPresence: true,
    consecutiveLosses: 0,
  }));
}

/**
 * Default (2019-preset) statePartyOrg array. Preserved for backward
 * compatibility with code paths that import the array directly rather
 * than calling `generateStatePartyOrg(preset)`. Prefer the function form
 * for preset-aware seeding.
 */
export const statePartyOrg = generateStatePartyOrg("2019-default");

export default statePartyOrg;
