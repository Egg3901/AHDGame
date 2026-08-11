// Turn-based party-membership tenure gate for leadership candidacy and voting.
// A character must have been a member of a party for at least this many turns
// before they may run for or vote in that party's leadership elections. The
// clock resets on every join (initial join, switch, or merge-absorption); see
// the stamp sites listed in the design doc.

export const PARTY_LEADERSHIP_TENURE_TURNS = 24;

// Residency required after relocating before a character may stand in — or be
// appointed into — STATE party leadership. Stops relocation-hopping into fresh
// state parties (ticket #949). Intentionally decoupled from the (longer)
// relocation cooldown RELOCATION_COOLDOWN_TURNS: local-leadership residency
// stays at 24 turns even as the movement cooldown is longer. A missing
// lastRelocatedTurn is grandfathered eligible.
export const STATE_LEADERSHIP_RELOCATION_DELAY_TURNS = 24;

export interface PartyTenure {
  /** currentTurn - partyJoinedTurn, clamped to >= 0; Infinity when grandfathered. */
  turnsServed: number;
  eligible: boolean;
  /** Turns still required before eligible; 0 when eligible. */
  turnsRemaining: number;
}

/**
 * Compute leadership tenure eligibility.
 *
 * A missing `partyJoinedTurn` (null/undefined) is treated as eligible so the
 * rollout never false-locks established members before the backfill runs.
 */
export function getPartyTenure(
  partyJoinedTurn: number | null | undefined,
  currentTurn: number,
  requiredTurns: number = PARTY_LEADERSHIP_TENURE_TURNS
): PartyTenure {
  if (partyJoinedTurn == null) {
    return { turnsServed: Number.POSITIVE_INFINITY, eligible: true, turnsRemaining: 0 };
  }
  const turnsServed = Math.max(0, currentTurn - partyJoinedTurn);
  const turnsRemaining = Math.max(0, requiredTurns - turnsServed);
  return { turnsServed, eligible: turnsRemaining === 0, turnsRemaining };
}
