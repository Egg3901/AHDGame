/**
 * Core vote calculation helpers for the election engine.
 */

import type { DemographicCategory, StateDemographics } from "@/lib/db/types";
import { calcAppeal, MAX_APPEAL } from "@/lib/utils/demographicAppeal";
import { normalizeNPI } from "@/lib/utils/normalizeNPI";

function clampPercentStat(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * Calculate effective favorability for a specific archetype.
 * effectiveFavorability = favorability + archetypeApproval * 0.5
 * Clamped to 0-100 range.
 */
export function calcEffectiveFavorability(
  baseFavorability: number,
  archetypeApproval: number | undefined
): number {
  const adjustment = (archetypeApproval ?? 0) * 0.5;
  return Math.max(0, Math.min(100, baseFavorability + adjustment));
}

// ─── Vote potential for one candidate in one state ──────────────────────────
//
// Simplified estimator (not the live vote engine):
//   potential = reached voters × (appeal / MAX_APPEAL)
//   appeal = position score vs the group (state-level: NPI is reach, not appeal)
//   reach  = normalizeNPI(politicalInfluence), name recognition in state
//

export function calcCandidateVotePotential(
  charEP: number,
  charSP: number,
  politicalInfluence: number,
  statePopulation: number,
  demographics: StateDemographics,
  categories: DemographicCategory[]
): number {
  // This helper is state-race specific, so PI should never outrun the 0-100 cap.
  const clampedPoliticalInfluence = clampPercentStat(politicalInfluence);
  let totalWeightedVoters = 0;

  for (const category of categories) {
    const categoryWeight = demographics.categoryWeights[category._id] ?? 0;

    for (const group of category.groups) {
      const stateGroup = demographics.groups[group.id];
      const populationPct = stateGroup?.population ?? 0;
      const demoEP = stateGroup?.economicLean ?? group.defaultEconomicLean;
      const demoSP = stateGroup?.socialLean ?? group.defaultSocialLean;
      const turnoutPct =
        (typeof stateGroup?.turnout === "number" ? stateGroup.turnout : group.defaultTurnout) ?? 55;

      // Reach: political influence (name recognition) determines what fraction of turned-out voters the candidate reaches
      const reachFraction = normalizeNPI(clampedPoliticalInfluence);

      const groupPop = statePopulation * (populationPct / 100);
      const turnoutPop = groupPop * (turnoutPct / 100);
      const reachedPop = turnoutPop * reachFraction;

      // Appeal (0-25): quadratic position only (state-level: NPI is reach, not appeal)
      const appeal = calcAppeal(demoEP, demoSP, charEP, charSP, clampedPoliticalInfluence, false);
      const rawPotential = reachedPop * (appeal / MAX_APPEAL);

      totalWeightedVoters += rawPotential * (categoryWeight / 100);
    }
  }

  return Math.max(0, totalWeightedVoters);
}

// ─── State estimated turnout (total voters in state) ─────────────────────────

export function calcStateTurnout(
  statePopulation: number,
  demographics: StateDemographics,
  categories: DemographicCategory[]
): number {
  let total = 0;
  for (const category of categories) {
    const categoryWeight = demographics.categoryWeights[category._id] ?? 0;
    let categoryTurnout = 0;
    for (const group of category.groups) {
      const stateGroup = demographics.groups[group.id];
      const populationPct = stateGroup?.population ?? 0;
      const turnoutPct =
        (typeof stateGroup?.turnout === "number" ? stateGroup.turnout : group.defaultTurnout) ?? 55;
      categoryTurnout += statePopulation * (populationPct / 100) * (turnoutPct / 100);
    }
    total += categoryTurnout * (categoryWeight / 100);
  }
  return Math.round(total);
}

// ─── Election turn window (totalTurns + current turnIndex) ────────────────────

const MS_PER_TURN_LOCAL = 3_600_000;

/**
 * Resolve the `{ totalTurns, turnIndex }` window that drives `turnVoteWeight`'s
 * 75/25 closing surge.
 *
 * Turn-first (drift-immune), mirroring `@/lib/elections/phases.ts`: when the
 * election carries numeric `startTurn` + `endTurn`, the window is derived purely
 * from turn numbers so the final-4-turn surge band always coincides with the
 * race's actual last 4 turns (`currentTurn >= endTurn` is what resolves it).
 *
 * The game clock (`gameNow`) can drift from the turn counter — `computeGameNow`
 * snaps up to real time after stalls and freezes on pause — and `endTime` /
 * `startTime` are frozen projections stamped at spawn. Deriving the surge window
 * from those timestamps let the surge land at the wrong time (or never, when the
 * race resolved on `endTurn` before the hour-based `turnIndex` reached the band).
 *
 * The Date path is retained as a permanent fallback for legacy / un-backfilled
 * docs that lack turn fields, reproducing the prior game-hours behavior exactly.
 */
export function resolveTurnWindow(args: {
  startTurn?: number | null;
  endTurn?: number | null;
  startTime?: Date | string | null;
  endTime?: Date | string | null;
  createdAt?: Date | string | null;
  currentTurn: number;
  now: Date;
}): { totalTurns: number; turnIndex: number } {
  const { startTurn, endTurn, startTime, endTime, createdAt, currentTurn, now } = args;

  // Turn-first: drift-immune when both bounds are real turn numbers.
  if (typeof startTurn === "number" && typeof endTurn === "number") {
    const totalTurns = Math.max(4, endTurn - startTurn);
    const turnIndex = Math.max(0, Math.min(currentTurn - startTurn, totalTurns - 1));
    return { totalTurns, turnIndex };
  }

  // Date fallback (legacy / un-backfilled): game-hours between start and end.
  const effectiveStart = startTime ? new Date(startTime) : createdAt ? new Date(createdAt) : now;
  const endMs = endTime ? new Date(endTime).getTime() : now.getTime();
  const totalTurns = Math.max(
    4,
    Math.round((endMs - effectiveStart.getTime()) / MS_PER_TURN_LOCAL)
  );
  const elapsed = Math.max(
    0,
    Math.round((now.getTime() - effectiveStart.getTime()) / MS_PER_TURN_LOCAL)
  );
  const turnIndex = Math.min(elapsed, totalTurns - 1);
  return { totalTurns, turnIndex };
}

// ─── Per-turn vote weight given total turns and current turn index ────────────

// Three-tier closing surge applied over the GENERAL-election voting window.
// IMPORTANT: the window passed in via `totalTurns`/`turnIndex` MUST start at
// the general-election start (`primaryEndTurn`), not the overall election
// `startTurn`. If it spans the primary too, the "early" share is smeared over
// primary turns that cast no general votes and the final turns balloon to
// ~66% of the vote instead of the intended ~30% (ticket #955).
export const ELECTION_DAY_TURNS = 4 as const; // sharp final-day spike band
export const RAMP_TURNS = 8 as const; // gentle build-up band before it
// Pool shares by tier — early / ramp / election-day. Must sum to 1.
export const EARLY_POOL_SHARE = 0.5 as const;
export const RAMP_POOL_SHARE = 0.2 as const;
export const FINAL_POOL_SHARE = 0.3 as const;

export function turnVoteWeight(
  totalTurns: number,
  turnIndex: number, // 0-based index into the general-election window
  totalPool: number
): number {
  if (totalTurns <= 0) return 0;
  // Very short races: no room for three tiers — spread the pool evenly.
  if (totalTurns <= ELECTION_DAY_TURNS) return totalPool / totalTurns;

  const finalCount = ELECTION_DAY_TURNS;
  const rampCount = Math.min(RAMP_TURNS, totalTurns - finalCount); // >= 1 here
  const earlyCount = totalTurns - finalCount - rampCount;

  // Fold an empty early band forward into the ramp so the per-turn weights
  // always integrate to `totalPool` across the window (conservation).
  let earlyShare: number = EARLY_POOL_SHARE;
  let rampShare: number = RAMP_POOL_SHARE;
  if (earlyCount === 0) {
    rampShare += earlyShare;
    earlyShare = 0;
  }

  const finalStart = totalTurns - finalCount;
  const rampStart = finalStart - rampCount;

  if (turnIndex >= finalStart) return (FINAL_POOL_SHARE * totalPool) / finalCount;
  if (turnIndex >= rampStart) return (rampShare * totalPool) / rampCount;
  // earlyCount > 0 guaranteed on this branch.
  return (earlyShare * totalPool) / earlyCount;
}
