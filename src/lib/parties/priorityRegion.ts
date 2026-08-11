/**
 * Priority Region cluster lifecycle helpers.
 *
 * A party's `priorityRegion` is a 2–4 state cluster the chair picks to
 * concentrate the party's PS-spending firepower. Actions targeting a
 * cluster state get a `+PRIORITY_REGION_EFFECT_BONUS` (+25%) multiplier
 * on their primary effect. Setting the cluster locks the slot for
 * `PRIORITY_REGION_LOCKOUT_TURNS` (168) turns — no changes, no clears,
 * no re-set until the cooldown expires.
 *
 * The cluster max size is normally `PRIORITY_REGION_MAX_STATES` (3),
 * but a party that holds the state-level executive in at least one of
 * the chosen cluster states at SET TIME gets `+PRIORITY_REGION_GOVERNOR
 * _ANCHOR_BONUS` (+1) capacity for that cluster — the "Governor anchor".
 * Anchor status is evaluated only at set time; losing the anchor mid-
 * lockout doesn't shrink the cluster (per 2026-05-23 spec).
 *
 * See `docs/plans/archive/2026-05/2026-05-21-things-left-deferrals.md`
 * §#13 for the original deferral; this module + the routes + UI ship
 * the base mechanic and the anchor together (2026-05-23).
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { adjacentStates } from "@/lib/constants/stateAdjacency";
import {
  PRIORITY_REGION_GOVERNOR_ANCHOR_BONUS,
  PRIORITY_REGION_LOCKOUT_TURNS,
  PRIORITY_REGION_MAX_STATES,
} from "@/lib/turn/politicalStrength/strengthConstants";
import type { PoliticalParty } from "@/lib/db/types";
import { getRegionalExecutive } from "@/lib/states/regionalExecutive";

// ─── Validation ──────────────────────────────────────────────────────────────

export type ClusterValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * The set of stateIds known to a country's adjacency map. Used to
 * reject picks that don't correspond to a real state/region in that
 * country.
 */
function isKnownState(country: CountryId, stateId: string): boolean {
  // `adjacentStates` returns [] for unknown — but [] is also a valid
  // legitimate response (no neighbors). Use the broader STATE_ADJACENCY
  // lookup via the adjacency function indirectly: a known state appears
  // as a key in the map. We don't import STATE_ADJACENCY directly here;
  // instead, treat "any state in adjacentStates(any known state) ∪
  // {known keys}" as known. Simpler: check that the state itself OR
  // any of its neighbors knows about it (symmetric adjacency invariant
  // means a known state with no neighbors is still findable via its
  // own row in the map, but if `adjacentStates` returns [] we can't
  // tell). Practical compromise: trust the API route's state-existence
  // lookup against the `states` collection for unknown-state rejection,
  // and only validate connectedness/adjacency here.
  void country;
  void stateId;
  return true;
}

/**
 * Maximum cluster size given whether the party qualifies for the
 * Governor anchor on this cluster.
 */
export function maxClusterSize(hasGovernorAnchor: boolean): number {
  return (
    PRIORITY_REGION_MAX_STATES + (hasGovernorAnchor ? PRIORITY_REGION_GOVERNOR_ANCHOR_BONUS : 0)
  );
}

/**
 * Returns true when the cluster is a single connected component under
 * the country's adjacency graph — every state in the cluster is
 * reachable from every other state via a chain of cluster-internal
 * neighbors.
 *
 * Pure: doesn't touch the DB. `adjacentStates(country, id)` is the
 * static adjacency table; the connectedness check is a BFS on the
 * subgraph induced by the cluster.
 *
 * Edge cases:
 *   - Single-state cluster → trivially connected.
 *   - Empty cluster → vacuously connected (caller should reject empty
 *     clusters via the size check, not here).
 *   - Duplicate state IDs → de-duped before traversal.
 */
export function isClusterConnected(country: CountryId, stateIds: readonly string[]): boolean {
  const unique = Array.from(new Set(stateIds));
  if (unique.length <= 1) return true;
  const set = new Set(unique);
  const visited = new Set<string>();
  const queue: string[] = [unique[0]!];
  visited.add(unique[0]!);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const neighbor of adjacentStates(country, cur)) {
      if (set.has(neighbor) && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited.size === unique.length;
}

/**
 * Validates a proposed cluster against:
 *   - size (≥ 2, ≤ max with anchor)
 *   - duplicates
 *   - connectedness under the country's adjacency graph
 *
 * Does NOT verify state-existence (that's a DB concern owned by the
 * route). Does NOT enforce the lockout (a separate helper —
 * `isPriorityRegionLocked` — does that).
 */
export function validatePriorityRegionCluster(
  country: CountryId,
  stateIds: readonly string[],
  hasGovernorAnchor: boolean
): ClusterValidationResult {
  const dedup = Array.from(new Set(stateIds));
  if (dedup.length !== stateIds.length) {
    return { ok: false, reason: "Cluster contains duplicate states." };
  }
  if (stateIds.length < 2) {
    return { ok: false, reason: "Priority Region needs at least 2 states." };
  }
  const max = maxClusterSize(hasGovernorAnchor);
  if (stateIds.length > max) {
    return {
      ok: false,
      reason: hasGovernorAnchor
        ? `Priority Region accepts at most ${max} states (3 base + 1 governor-anchor bonus).`
        : `Priority Region accepts at most ${max} states.`,
    };
  }
  // Defer to the route for state-existence; here we only check graph shape.
  for (const id of stateIds) {
    if (!isKnownState(country, id)) {
      return { ok: false, reason: `Unknown state: ${id}` };
    }
  }
  if (!isClusterConnected(country, stateIds)) {
    return {
      ok: false,
      reason:
        "Cluster states must form one connected adjacency-graph component (each state adjacent to at least one other in the cluster).",
    };
  }
  return { ok: true };
}

// ─── Lockout ────────────────────────────────────────────────────────────────

/**
 * Returns the turn at which the lockout expires (exclusive: at that
 * turn the cluster is settable again). Pre-condition: party.priorityRegion
 * is set.
 */
export function priorityRegionUnlockTurn(
  party: Pick<PoliticalParty, "priorityRegion">
): number | null {
  if (!party.priorityRegion) return null;
  return party.priorityRegion.setAtTurn + PRIORITY_REGION_LOCKOUT_TURNS;
}

/**
 * True when the party's priority-region slot is currently locked for
 * re-setting. An empty cluster (states all evicted) still locks until
 * the cooldown expires — per the original plan, the slot stays empty
 * but committed.
 */
export function isPriorityRegionLocked(
  party: Pick<PoliticalParty, "priorityRegion">,
  currentTurn: number
): boolean {
  const unlockAt = priorityRegionUnlockTurn(party);
  return unlockAt != null && unlockAt > currentTurn;
}

// ─── Governor anchor ────────────────────────────────────────────────────────

/**
 * Returns true when the party holds the state-level executive in at
 * least one of the given states. Uses `getRegionalExecutive` so the
 * per-country office mapping (US governor / DE Minister-President / JP
 * prefectural governor / UK devolved First Minister / Mayor of London)
 * stays in one place — countries without a state-level executive (IE,
 * CN, English non-London UK regions, etc.) simply return null per
 * state and the helper returns false.
 *
 * Evaluated at SET time only. Losing the anchor mid-lockout does NOT
 * shrink the cluster (per the 2026-05-23 spec).
 */
export async function partyHoldsStateExecutiveInCluster(
  db: Db,
  party: Pick<PoliticalParty, "sequentialId">,
  country: CountryId,
  stateIds: readonly string[]
): Promise<boolean> {
  const partyIdStr = String(party.sequentialId);
  for (const stateId of stateIds) {
    const exec = await getRegionalExecutive(db, country, stateId);
    if (exec && exec.partyId === partyIdStr) {
      return true;
    }
  }
  return false;
}

// ─── Read helper ────────────────────────────────────────────────────────────

/**
 * Returns true when the given state is currently in the party's
 * priority-region cluster. Used by action handlers to decide whether
 * to apply the `PRIORITY_REGION_EFFECT_BONUS` multiplier.
 *
 * Defensive on absent / empty / null cluster — returns false.
 */
export function isStateInPriorityRegion(
  party: Pick<PoliticalParty, "priorityRegion">,
  stateId: string
): boolean {
  const cluster = party.priorityRegion;
  if (!cluster || cluster.stateIds.length === 0) return false;
  return cluster.stateIds.includes(stateId);
}
