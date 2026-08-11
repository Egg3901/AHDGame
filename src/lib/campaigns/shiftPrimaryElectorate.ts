/**
 * Produces a primary-voter electorate from a state's general-electorate
 * demographics by **scaling turnout per group based on directional alignment
 * with the party** (not distance from it).
 *
 * The distinction matters. A Dem primary voter at (-4, -4) is MORE extreme
 * than the Dem party at (-2, -2) — they participate heavily; a distance-based
 * penalty would (wrongly) punish them for being too far left. A symmetric
 * "distance from party" model can't capture this asymmetry.
 *
 * Model: project the voter's ideology vector onto the party's ideology axis
 * and normalize. Voters whose projection is ≥ party's own magnitude participate
 * fully. Voters near the origin (no ideology) participate lightly. Voters on
 * the opposite side don't participate at all.
 *
 *   alignment = (voter · party) / |party|²
 *
 * Turnout retention = clamp(alignment, floor, 1.0).
 *
 *   Voter (-4,-4), Dem (-2,-2): alignment = 2.0 → retention 1.0 (base voter)
 *   Voter (-2,-2), Dem (-2,-2): alignment = 1.0 → retention 1.0 (aligned)
 *   Voter (-1,-1), Dem (-2,-2): alignment = 0.5 → retention 0.5 (soft Dem)
 *   Voter ( 0, 0), Dem (-2,-2): alignment = 0.0 → retention floor (centrist)
 *   Voter (+2,+2), Dem (-2,-2): alignment = -1.0 → retention floor (opposed)
 *
 * The FLOOR prevents numerical collapse but is tiny — opposed voters have
 * ≈0 weight in the primary pool.
 */

import type { DemographicCategory, StateDemographics } from "@/lib/db/types";

/** Minimum fraction of general turnout any group retains (prevents zero-division). */
export const PRIMARY_TURNOUT_FLOOR = 0.05;

/**
 * Baseline retention at "zero alignment" (perfect centrist voter). Higher values
 * make the primary electorate less different from the general — centrists still
 * matter. 0.5 means a centrist group turns out at half its general rate.
 */
export const PRIMARY_CENTRIST_RETENTION = 0.5;

export interface PartyPositionInput {
  economicPosition: number;
  socialPosition: number;
}

/**
 * Directional-alignment retention for one demographic group vs a party.
 * Shared by `shiftDemographicsForPrimary` (projection) and
 * `applyPrimaryTurnoutRetention` (stagger / polls that already have live
 * GOTV turnouts from `resolveTurnout`).
 */
export function primaryTurnoutRetention(
  economicLean: number,
  socialLean: number,
  partyPosition: PartyPositionInput
): number {
  // |party|² — guarded with max(1, ...) so a perfectly-centrist party (0,0)
  // doesn't divide by zero. In that degenerate case every voter gets zero
  // alignment → floor → uniform near-zero turnout.
  const partyMagSq = Math.max(
    1,
    partyPosition.economicPosition * partyPosition.economicPosition +
      partyPosition.socialPosition * partyPosition.socialPosition
  );
  const alignment =
    (economicLean * partyPosition.economicPosition + socialLean * partyPosition.socialPosition) /
    partyMagSq;
  // Softened curve: aligned voters (alignment>=1) full; centrists 50%;
  // opposed voters drop to the floor. Keeps home-state boost meaningful.
  return Math.max(
    PRIMARY_TURNOUT_FLOOR,
    Math.min(1.0, PRIMARY_CENTRIST_RETENTION + (1 - PRIMARY_CENTRIST_RETENTION) * alignment)
  );
}

/**
 * Directional-alignment scaling: voters WITH the party (same sign, any
 * magnitude) participate fully; centrist voters participate lightly;
 * voters AGAINST the party stay home.
 */
export function shiftDemographicsForPrimary(
  demographics: StateDemographics,
  partyPosition: PartyPositionInput
): StateDemographics {
  const shiftedGroups: StateDemographics["groups"] = {};
  for (const [groupId, group] of Object.entries(demographics.groups)) {
    const retention = primaryTurnoutRetention(group.economicLean, group.socialLean, partyPosition);
    const baseTurnout = group.turnout ?? 55;
    shiftedGroups[groupId] = {
      ...group,
      turnout: Math.max(0, baseTurnout * retention),
    };
  }
  return {
    ...demographics,
    groups: shiftedGroups,
  };
}

/**
 * Apply the same primary-electorate retention curve to an already-resolved
 * live turnout map (GOTV / Layer-1 / canvassing).
 *
 * Why this exists: `resolveTurnout` / `buildLiveTurnouts` for US states rebuild
 * archetype turnouts from Layer-1 census baselines and **ignore** any turnout
 * already written onto `StateDemographics.groups`. If stagger shifts demographics
 * for the primary and then passes those Layer-1 `liveTurnouts` into vote
 * distribution, the primary electorate shift is completely wiped — projection
 * (no liveTurnouts) and live results diverge systematically.
 *
 * Call this on the general-electorate live turnouts, then recompute the pool
 * with {@link computeTurnoutPoolFromRates}.
 */
export function applyPrimaryTurnoutRetention(
  turnoutsByGroup: Record<string, number>,
  demographics: StateDemographics,
  partyPosition: PartyPositionInput
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [groupId, turnout] of Object.entries(turnoutsByGroup)) {
    const group = demographics.groups[groupId];
    if (!group) {
      result[groupId] = turnout;
      continue;
    }
    const retention = primaryTurnoutRetention(group.economicLean, group.socialLean, partyPosition);
    result[groupId] = Math.max(0, turnout * retention);
  }
  return result;
}

/**
 * Recompute the weighted turnout pool from an explicit per-group turnout map.
 * Mirrors the pool math inside `resolveTurnout` so liveTurnouts and totalPool
 * stay consistent after primary retention is applied.
 */
export function computeTurnoutPoolFromRates(
  statePopulation: number,
  demographics: StateDemographics,
  categories: DemographicCategory[],
  turnoutsByGroup: Record<string, number>
): number {
  let totalPool = 0;
  for (const category of categories) {
    const categoryWeight = demographics.categoryWeights[category._id] ?? 0;
    if (categoryWeight <= 0) continue;
    for (const group of category.groups) {
      const stateGroup = demographics.groups[group.id];
      const populationPct = stateGroup?.population ?? 0;
      const turnoutPct = turnoutsByGroup[group.id] ?? 0;
      totalPool +=
        statePopulation * (populationPct / 100) * (turnoutPct / 100) * (categoryWeight / 100);
    }
  }
  return Math.round(totalPool);
}
