/**
 * Party growth frontier.
 *
 * A party may only grow into regions it already touches. The frontier is the
 * party's live presence set expanded by exactly one adjacency hop:
 *
 *   presence(P) = regions holding >=1 member, >=1 elected official, or
 *                 >=1 active NPP of P
 *   frontier(P) = presence(P) UNION neighbours(presence(P))
 *
 * Gates NPP recruitment, NPP relocation and player party-joining. Presence is
 * the same signal `checkPartyPresence` uses, so a recruited NPP extends the
 * frontier and a party expands outward one hop at a time.
 *
 * Presence is always read LIVE. Never gate on `statePartyOrg.hasPresence` —
 * that cached flag only refreshes on membership events and lags, which is the
 * same reason the Build Org foothold rule re-checks presence live.
 */
import { adjacentStates } from "@/lib/constants/stateAdjacency";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Expand a presence set by exactly one adjacency hop. Pure.
 *
 * A state with no entry in the country's adjacency map contributes only
 * itself — `adjacentStates` returns [] for both an unknown state and a
 * genuinely isolated one (US `HI`), and the two are indistinguishable here.
 */
export function expandFrontier(countryId: CountryId, presence: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const stateId of presence) {
    if (!stateId) continue;
    out.add(stateId);
    for (const neighbour of adjacentStates(countryId, stateId)) out.add(neighbour);
  }
  return out;
}

/**
 * The gate. Fails OPEN in two cases, both deliberate:
 *
 *   - Empty presence: a party with no members, officials or NPPs has no
 *     geography to violate. Gating it would make it permanently unjoinable and
 *     permanently dead. The first joiner re-anchors it.
 *   - No `stateId`: legacy/seed characters without a home state cannot be
 *     placed. Blocking would hard-lock them out of every party in the game.
 */
export function isInFrontier(
  presence: ReadonlySet<string>,
  frontier: ReadonlySet<string>,
  stateId: string | null | undefined
): boolean {
  if (presence.size === 0) return true;
  if (!stateId) return true;
  return frontier.has(stateId);
}
