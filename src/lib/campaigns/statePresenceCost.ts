/**
 * The price of the next Campaign Presence level, and the one way it is written.
 *
 * Three screens offer this build — the campaign manager's State operations hub,
 * the Political Operations tab, and the per-state primary page — and each used
 * to price it differently. One quoted the escalating ladder in the campaign's
 * currency, one quoted the same ladder in anchor units, and one quoted the flat
 * base constant, which is right only for a state at level 0. A player checking
 * two screens saw two numbers, and only one of them was what the build route
 * charges.
 *
 * Pure and client-safe on purpose: the routes resolve the rate server-side and
 * hand back an already-converted figure, and anything that has to price a level
 * the server did not enumerate (the hub's chooser covers every state, not just
 * the ones already built in) runs this with the rate the view carries.
 */

import { stateOrgLevelCost } from "@/lib/electionEngine/constants";

/**
 * Cost of the level that takes a state from `currentLevel` to `currentLevel + 1`,
 * converted into the campaign's own currency.
 *
 * `stateOrgLevelCost` is anchor-denominated and the campaign treasury is not, so
 * the conversion is not optional: the build route charges
 * `anchor x rate` and a quote without it is a number nobody is ever charged.
 */
export function statePresenceNextCost(currentLevel: number, fxRate: number): number {
  return stateOrgLevelCost(currentLevel) * fxRate;
}

/** How that price is written, everywhere it is written. */
export function formatStatePresenceCost(cost: number): string {
  return `$${Math.round(cost).toLocaleString("en-US")}`;
}
