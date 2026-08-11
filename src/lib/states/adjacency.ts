/**
 * US action-cost helpers — distance multiplier on influence/boost actions
 * based on the actor's home state vs target state.
 *
 * The underlying US adjacency data lives in
 * `src/lib/constants/stateAdjacency.ts` as the per-country canonical map.
 * Sea-border policy (e.g. AK ↔ WA, MI ↔ WI Lake Michigan) is shared with
 * the F4 charter founding-cohort picker — so a player relocating an NPP
 * pays the same neighbor-vs-distant cost as the picker treats as
 * "adjacent". Single source of truth.
 */

import { adjacentStates } from "@/lib/constants/stateAdjacency";

/**
 * Action cost multipliers based on state relationship
 */
export const ACTION_COST_MULTIPLIERS = {
  HOME_STATE: 1.0,
  NEIGHBORING_STATE: 1.25,
  DISTANT_STATE: 1.5,
} as const;

/**
 * Get the action cost multiplier for an action from one state to another
 * @param homeState The actor's home state
 * @param targetState The state where the action is taking place
 * @returns The cost multiplier (1.0, 1.25, or 1.5)
 */
export function getActionCostMultiplier(homeState: string, targetState: string): number {
  if (homeState === targetState) {
    return ACTION_COST_MULTIPLIERS.HOME_STATE;
  }

  const neighbors = adjacentStates("US", homeState);
  if (neighbors.includes(targetState)) {
    return ACTION_COST_MULTIPLIERS.NEIGHBORING_STATE;
  }

  return ACTION_COST_MULTIPLIERS.DISTANT_STATE;
}

/**
 * Calculate the actual action cost with location multiplier
 * @param baseCost The base action cost
 * @param homeState The actor's home state
 * @param targetState The state where the action is taking place
 * @returns The adjusted action cost (rounded up)
 */
export function calculateActionCost(
  baseCost: number,
  homeState: string,
  targetState: string
): number {
  const multiplier = getActionCostMultiplier(homeState, targetState);
  return Math.ceil(baseCost * multiplier);
}

/**
 * Check if two states are neighbors
 */
export function areStatesNeighbors(state1: string, state2: string): boolean {
  const neighbors = adjacentStates("US", state1);
  return neighbors.includes(state2);
}
