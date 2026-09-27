/**
 * Pure NPP election entry logic - no DB access, no side effects.
 */

import type { NPP, Election, ElectionCandidate } from "@/lib/db/types";
import { isElectionTypeEntryBlocked } from "@/lib/elections/nationwideExecutive";
import { getRacePriority } from "@/lib/turn/rules/nppElectionPriority";

export {
  RACE_PRIORITY,
  getRacePriority,
  type RaceType,
} from "@/lib/turn/rules/nppElectionPriority";

/**
 * NPPs pick the highest-priority open primary in their home state. This list
 * only covers races they are still allowed to auto-enter; presidential
 * primaries are intentionally omitted because the runtime blocks them entirely.
 * Commons now sits between house and senate so UK constituency races are
 * considered after lower-chamber U.S. seats but before statewide upper-chamber
 * contests.
 * Snap variants share their regular counterpart's position; see
 * `rules/nppElectionPriority`.
 */

/**
 * Regional-presence gate for NPP candidate fielding (1953 sim forensics: NPP
 * entry had no regional-party gating, so SNP NPPs homed in London happily
 * contested English seats).
 *
 * A party with NO statePartyOrg row in a region — or an explicit
 * `hasPresence: false` — has no local organisation there and must not field
 * NEW candidates in that region. Entirely data-driven (statePartyOrg
 * presence), no hardcoded country tables.
 *
 * Deliberate exemptions:
 * - Regions with no statePartyOrg data at all (`stateHasOrgData === false`):
 *   unseeded worlds / countries without org rows keep the legacy behavior.
 * - Independents: they never have org rows by design.
 * - Incumbent defense is NOT routed through this gate (callers skip it): a
 *   sitting seat-holder may always appear in their own defense primary.
 */
export function canPartyFieldInState(
  orgRow: { hasPresence?: boolean } | undefined,
  stateHasOrgData: boolean,
  party: string
): boolean {
  if (party === "independent") return true;
  if (!stateHasOrgData) return true;
  if (!orgRow) return false;
  return orgRow.hasPresence !== false;
}

/**
 * Check if an NPP is available to enter any primary.
 * Does NOT check per-election cooldowns (that's done in shouldEnterPrimary).
 */
export function isNPPAvailable(npp: NPP, activeCandidacies: Set<string>, _now: Date): boolean {
  // Retired NPPs can't enter
  if (npp.retiredAt) return false;

  // Already in an active race
  if (activeCandidacies.has(npp._id.toString())) return false;

  return true;
}

/**
 * Check if an NPP should enter a specific primary.
 *
 * NPPs are barred from presidential races - a player should always have the
 * opportunity to contest the presidency, and auto-entering NPPs distorts the
 * primary field with candidates the player base never explicitly chose.
 */
export function shouldEnterPrimary(
  npp: NPP,
  election: Election,
  existingCandidates: ElectionCandidate[],
  now: Date
): boolean {
  // NPPs may not enter presidential races
  if (election.electionType === "president") return false;
  if (isElectionTypeEntryBlocked(election.electionType)) return false;

  // Check cooldown for this specific election
  const cooldownExpiry = npp.electionCooldowns?.[election._id.toString()];
  if (cooldownExpiry && new Date(cooldownExpiry) > now) {
    return false;
  }

  // Check if same-party candidate already exists
  const hasSamePartyCandidate = existingCandidates.some(
    (c) => c.party === npp.party && c.status === "active"
  );
  if (hasSamePartyCandidate) return false;

  return true;
}

/**
 * Check whether an incumbent NPP should auto-defend a specific primary.
 *
 * Incumbent defense is stricter about duplicate self-filing but intentionally
 * ignores same-party challengers and cooldowns for that same seat. The sitting
 * NPP should always be able to show up in the defense primary unless they are
 * already actively filed in it.
 */
export function shouldDefendPrimary(
  npp: NPP,
  election: Election,
  existingCandidates: ElectionCandidate[]
): boolean {
  if (election.electionType === "president") return false;
  if (isElectionTypeEntryBlocked(election.electionType)) return false;

  const alreadyActiveForSeat = existingCandidates.some(
    (c) => c.status === "active" && c.isNPP === true && c.nppId?.toString() === npp._id.toString()
  );
  if (alreadyActiveForSeat) return false;

  return true;
}

/**
 * Select the best primary for an NPP to enter based on priority.
 * Returns null if no eligible primary found.
 */
export function selectBestPrimary(
  npp: NPP,
  elections: Election[],
  candidatesByElection: Map<string, ElectionCandidate[]>,
  now: Date
): Election | null {
  // NPPs are barred from presidential primaries (see shouldEnterPrimary)
  // and from any race type whose resolver isn't production-ready.
  const eligibleElections = elections.filter((e) => {
    if (e.electionType === "president") return false;
    if (isElectionTypeEntryBlocked(e.electionType)) return false;
    // All other elections (including UK commons) are regional - homeState must match
    return e.state === npp.homeState;
  });

  // Sort by priority
  const sorted = [...eligibleElections].sort((a, b) => {
    return getRacePriority(a.electionType) - getRacePriority(b.electionType);
  });

  // Find first election NPP can enter
  for (const election of sorted) {
    const candidates = candidatesByElection.get(election._id.toString()) ?? [];
    if (shouldEnterPrimary(npp, election, candidates, now)) {
      return election;
    }
  }

  return null;
}
