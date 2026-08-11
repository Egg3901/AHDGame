/**
 * Election-types that represent the country's nationwide, directly-elected
 * executive office. These races are spawned with `state === countryId`
 * (single constituency for the whole country) instead of a sub-national
 * region, so the per-region home-state restriction must be relaxed and the
 * country-level term limit must be enforced at entry.
 *
 * Parliamentary executives (UK PM, JP PM, DE Chancellor, IE Taoiseach,
 * CN Premier) are NOT in this set — they're chosen by their legislature,
 * not elected directly, so they never flow through `electionCandidates`.
 *
 * Add a new entry here when a country ships a directly-elected nationwide
 * executive race (e.g. BR President once activated).
 */
export const NATIONWIDE_DIRECT_EXECUTIVE_ELECTION_TYPES: ReadonlySet<string> = new Set([
  "president", // US
  "uachtaran", // IE
]);

/**
 * Returns true when the given election is a directly-elected nationwide
 * executive race. Both the electionType AND the state must match the country
 * — defensive against malformed elections that share a type but use a
 * sub-national state.
 */
export function isNationwideDirectExecutiveElection(
  electionType: string,
  electionState: string | undefined | null,
  countryId: string
): boolean {
  if (!NATIONWIDE_DIRECT_EXECUTIVE_ELECTION_TYPES.has(electionType)) return false;
  return electionState === countryId;
}

/**
 * Election types whose resolution path is not production-ready and must reject
 * candidacy attempts. Keep the shared gate even while the set is empty so a
 * future incomplete spawner cannot accidentally expose a broken filing path.
 *
 * Ireland's Uachtaran race is intentionally not blocked. The 1.0 resolver uses
 * the configured direct-plurality model; exact preference-transfer fidelity is
 * a later electoral-system upgrade, not a reason to leave the office vacant.
 */
export const ENTRY_BLOCKED_ELECTION_TYPES: ReadonlySet<string> = new Set();

export function isElectionTypeEntryBlocked(electionType: string): boolean {
  return ENTRY_BLOCKED_ELECTION_TYPES.has(electionType);
}
