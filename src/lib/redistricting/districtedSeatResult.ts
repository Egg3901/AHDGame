import type { Nominee } from "./districtedResolution";

/**
 * Build the per-party nominee lists with a sharePct each. Prefer primary
 * shares (PrimaryResultEntry.sharePct, won nominees); otherwise fall back to
 * each candidate's normalized statewide vote share within its party.
 */
export function buildNomineesByParty(
  candidateParty: Record<string, string>,
  candidateVotes: Record<string, number>,
  primaryShares: Record<string, number> | null
): Record<string, Nominee[]> {
  const byParty: Record<string, Nominee[]> = {};
  // Group candidates by party.
  const groups: Record<string, string[]> = {};
  for (const [cid, party] of Object.entries(candidateParty)) {
    (groups[party] ??= []).push(cid);
  }
  for (const [party, cids] of Object.entries(groups)) {
    if (primaryShares) {
      byParty[party] = cids.map((cid) => ({ candidateId: cid, sharePct: primaryShares[cid] ?? 0 }));
    } else {
      const total = cids.reduce((s, c) => s + (candidateVotes[c] ?? 0), 0) || 1;
      byParty[party] = cids.map((cid) => ({
        candidateId: cid,
        sharePct: ((candidateVotes[cid] ?? 0) / total) * 100,
      }));
    }
  }
  return byParty;
}

export function buildSeatResult(
  assignment: Map<number, string>,
  allCandidateIds: string[],
  authoritativeSeats: number
): {
  isMultiSeat: boolean;
  authoritativeSeats: number;
  seatsEstimate: Record<string, number>;
  winners: [string, number][];
  losers: string[];
} {
  const seatsEstimate: Record<string, number> = {};
  for (const cid of assignment.values()) {
    seatsEstimate[cid] = (seatsEstimate[cid] ?? 0) + 1;
  }
  const winners = Object.entries(seatsEstimate).map(([id, n]) => [id, n] as [string, number]);
  const winnerSet = new Set(Object.keys(seatsEstimate));
  const losers = allCandidateIds.filter((id) => !winnerSet.has(id));
  return { isMultiSeat: true, authoritativeSeats, seatsEstimate, winners, losers };
}
