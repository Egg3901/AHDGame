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

/** The subset of a character the leadership gate reads. */
export interface LeadershipTenureSubject {
  partyJoinedTurn?: number | null;
  /** Sequential id of a party this character founded by charter, if any. */
  foundedPartyId?: string | null;
}

/**
 * Leadership candidacy/voting eligibility for a character in a given party.
 *
 * A charter founder is exempt from the tenure clock in the party they founded:
 * ratification stamps their `partyJoinedTurn` to the founding turn, which would
 * otherwise lock all three founders out of their own brand-new party for
 * `PARTY_LEADERSHIP_TENURE_TURNS`. The exemption is scoped to that one party, so
 * a founder who joins someone else's party still serves the full tenure there.
 *
 * Everyone else falls through to `getPartyTenure`. This wraps the party-tenure
 * gate only — the relocation-residency checks that reuse `getPartyTenure` with
 * `STATE_LEADERSHIP_RELOCATION_DELAY_TURNS` are a different rule and must keep
 * calling it directly.
 */
export function getLeadershipEligibility(
  subject: LeadershipTenureSubject,
  currentTurn: number,
  partyId: string | number
): PartyTenure {
  const founded = subject.foundedPartyId;
  if (founded != null && founded !== "" && founded === String(partyId)) {
    return { turnsServed: Number.POSITIVE_INFINITY, eligible: true, turnsRemaining: 0 };
  }
  return getPartyTenure(subject.partyJoinedTurn, currentTurn);
}
