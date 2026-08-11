/**
 * Resolve which party ID to use when colouring / labeling a candidate on
 * election result surfaces (maps, charts, hover cards).
 *
 * Live character.party can diverge from the party a candidate ran under
 * (party switches after the race). For historical / ended elections we must
 * never colour by the live affiliation:
 *   1. tally.candidateParties snapshot (set at tally init / resolution)
 *   2. ElectionCandidate.party (ballot / entry-time party on the candidacy row)
 *   3. optional live fallback (only for in-progress races)
 *
 * See #939.
 */

export interface ResolveElectionPartyInput {
  /** True for ended or finalized elections — prefer election-time party. */
  preferElectionTimeParty: boolean;
  /** Party ID from ElectionVoteTally.candidateParties, if present. */
  snapshotParty?: string | null;
  /** Party ID from the ElectionCandidate row (entry-time). */
  ballotParty?: string | null;
  /** Live display party (character.party), used only while the race is in progress. */
  liveParty?: string | null;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Pick the party ID that result maps / labels should use for a candidate.
 */
export function resolveElectionDisplayParty(input: ResolveElectionPartyInput): string {
  const snapshot = nonEmpty(input.snapshotParty);
  const ballot = nonEmpty(input.ballotParty);
  const live = nonEmpty(input.liveParty);

  if (input.preferElectionTimeParty) {
    return snapshot ?? ballot ?? live ?? "independent";
  }
  return live ?? snapshot ?? ballot ?? "independent";
}
