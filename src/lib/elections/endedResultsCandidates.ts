/**
 * Pick the candidates to show in an *ended* election's final results.
 *
 * Election resolution withdraws **every** candidate as cleanup, so a candidate's
 * `withdrawn` status alone can't distinguish a real contestant from someone who
 * dropped out before the general (or lost their primary). The reliable signal is
 * the final vote tally: a candidate who actually contested has votes there.
 *
 * - When the tally has any votes, keep candidates who have votes (drops the
 *   0-vote primary-loser / pre-general-withdrawal rows that would only clutter
 *   the results).
 * - When the tally has no votes (or is missing), fall back to the prior
 *   behavior of dropping withdrawn candidates, so an unresolved/edge-case
 *   election still renders its remaining field.
 */
export function selectEndedDisplayCandidates<T extends { id: string }>(
  enriched: T[],
  withdrawnIds: Set<string>,
  tallyTotalVotes: Record<string, number> | undefined
): T[] {
  const votes = tallyTotalVotes ?? {};
  const anyVotes = Object.values(votes).some((v) => v > 0);
  if (anyVotes) {
    return enriched.filter((c) => (votes[c.id] ?? 0) > 0);
  }
  return enriched.filter((c) => !withdrawnIds.has(c.id));
}
