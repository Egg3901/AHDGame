/**
 * When and how a governor or legislature can redraw House districts. Three state
 * laws set the limits (computeRedistrictCaps): redistricting authority decides who
 * may draw (only a legislature-drawn map lets players draw; an independent
 * commission neutralizes maps), compactness caps how far a district's lean may
 * stray from the state mean (4, 8 or 12 points), and fairness caps the efficiency
 * gap (10%, 20% or 35%).
 */
import type { Db } from "mongodb";

export const REDISTRICT_AUTHORITY_LAW = "us_state_redistricting_authority";
export const REDISTRICT_COMPACTNESS_LAW = "us_state_compactness";
export const REDISTRICT_FAIRNESS_LAW = "us_state_fairness";

export interface RedistrictCaps {
  canDraw: boolean;
  autoNeutralize: boolean;
  maxDistrictDeviation: number;
  maxPackedDistricts: number;
  efficiencyGapCeiling: number;
}

/** Authority option (index) → who-may-draw lever. */
const AUTHORITY_TABLE: { canDraw: boolean; autoNeutralize: boolean }[] = [
  { canDraw: false, autoNeutralize: true }, // 0 Independent commission
  { canDraw: false, autoNeutralize: false }, // 1 Bipartisan commission (default)
  { canDraw: true, autoNeutralize: false }, // 2 Legislature-drawn
];

/**
 * Compactness option (index) → per-district extremity caps. `maxDistrictDeviation`
 * is how far a district's netLean may stray from the state mean; it gates how
 * *decisive* a redraw can be. The old 3/6/10 tiers held a leaning state's pickups
 * to thin, competitive-band wins at Moderate (a +2 ceiling on a mean −3.8 state),
 * so a "Max" redraw never produced visible lean/safe districts. Widened to 4/8/12
 * so Moderate can express a real (but still bounded) gerrymander; the efficiency
 * gap remains the primary fairness guardrail.
 */
const COMPACTNESS_TABLE: { maxDistrictDeviation: number; maxPackedFraction: number }[] = [
  { maxDistrictDeviation: 4, maxPackedFraction: 0 }, // 0 Strict
  { maxDistrictDeviation: 8, maxPackedFraction: 1 / 3 }, // 1 Moderate (default)
  { maxDistrictDeviation: 12, maxPackedFraction: 1 / 2 }, // 2 Loose
];

/**
 * Fairness option (index) → statewide efficiency-gap ceiling. Tuned loose so a
 * legislature-drawn map can actually express its strategy: the raw efficiency gap
 * penalizes lopsided outcomes even when they reflect a state's natural lean, so
 * tight ceilings prevented even leaning states from electing to their lean. At
 * Loose, leaning states can sweep and balanced states swing ~3 seats; Strict
 * still acts as a real fairness guardrail.
 */
const FAIRNESS_TABLE: number[] = [0.1, 0.2, 0.35]; // Strict, Moderate (default), Loose

function clampIndex(i: number, len: number): number {
  return Number.isInteger(i) && i >= 0 && i < len ? i : 1; // default to center
}

export function resolveRedistrictCaps(
  authorityIndex: number,
  compactnessIndex: number,
  fairnessIndex: number,
  n: number
): RedistrictCaps {
  const a = AUTHORITY_TABLE[clampIndex(authorityIndex, AUTHORITY_TABLE.length)];
  const c = COMPACTNESS_TABLE[clampIndex(compactnessIndex, COMPACTNESS_TABLE.length)];
  const eg = FAIRNESS_TABLE[clampIndex(fairnessIndex, FAIRNESS_TABLE.length)];
  return {
    canDraw: a.canDraw,
    autoNeutralize: a.autoNeutralize,
    maxDistrictDeviation: c.maxDistrictDeviation,
    maxPackedDistricts: Math.max(0, Math.ceil(n * c.maxPackedFraction)),
    efficiencyGapCeiling: eg,
  };
}

async function readOptionIndex(
  db: Db,
  stateId: string,
  legislationTypeId: string
): Promise<number> {
  const policy = await db
    .collection<{ policyOptionIndex?: number }>("statePolicies")
    .findOne({ stateId, legislationTypeId });
  return policy?.policyOptionIndex ?? 1; // center default
}

export async function computeRedistrictCaps(
  db: Db,
  _countryId: string,
  stateId: string,
  n: number
): Promise<RedistrictCaps> {
  const [auth, comp, fair] = await Promise.all([
    readOptionIndex(db, stateId, REDISTRICT_AUTHORITY_LAW),
    readOptionIndex(db, stateId, REDISTRICT_COMPACTNESS_LAW),
    readOptionIndex(db, stateId, REDISTRICT_FAIRNESS_LAW),
  ]);
  return resolveRedistrictCaps(auth, comp, fair, n);
}
