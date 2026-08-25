/**
 * Pure election calculation functions — no DB access, no side effects.
 *
 * Extracted from electionResolution.ts so that vote math and EV allocation
 * can be unit-tested without a real database.
 */

import { createHash } from "crypto";
import { ELECTORAL_VOTE_UNITS, ELECTORAL_MAJORITY } from "@/lib/constants";

export { ELECTORAL_MAJORITY };

/**
 * Allocate Electoral Votes from per-unit vote totals.
 *
 * Each electoral unit (state + DC + congressional district) goes to the
 * candidate with the most raw votes in that unit.  EV value is added to
 * that candidate's running total.
 *
 * @param totalVotesByUnit - Keyed by unitId → candidateId → vote total
 * @param units - Electoral vote units to allocate from. Defaults to the
 *   2020-census `ELECTORAL_VOTE_UNITS`; pass `getElectoralVoteUnits(preset)`
 *   to allocate with the active preset's apportionment (e.g. 1990 census).
 * @returns Map of candidateId → total electoral votes won
 */
export function allocateElectoralVotes(
  totalVotesByUnit: Record<string, Record<string, number>>,
  units: { unitId: string; ev: number; stateId: string }[] = ELECTORAL_VOTE_UNITS
): Record<string, number> {
  const electoralVotesByCandidate: Record<string, number> = {};

  for (const unit of units) {
    const unitVotes = totalVotesByUnit[unit.unitId];
    if (!unitVotes) continue;

    const entries = Object.entries(unitVotes)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) continue;

    // Resolve exact ties at the unit level deterministically using a hash of
    // the unit and tied candidate IDs rather than relying on object-key order.
    let winnerId = entries[0][0];
    if (entries.length >= 2 && entries[0][1] === entries[1][1]) {
      const tiedIds = entries
        .filter(([, v]) => v === entries[0][1])
        .map(([id]) => id)
        .sort();
      const seed = createHash("sha256")
        .update(`${unit.unitId}:${tiedIds.join(":")}`)
        .digest()[0];
      winnerId = tiedIds[seed % tiedIds.length];
    }

    electoralVotesByCandidate[winnerId] = (electoralVotesByCandidate[winnerId] ?? 0) + unit.ev;
  }

  return electoralVotesByCandidate;
}

// Majority of the ACTUAL college (era-aware). Canonical definition lives in
// the client-safe display module; re-exported here for the turn engine.
export { electoralMajorityFor } from "@/lib/elections/presidentialResolutionDisplay";

/**
 * Determine the presidential winner from Electoral Vote totals.
 *
 * If a candidate reaches `evNeeded` (a majority of the actual college — pass
 * `electoralMajorityFor(collegeSize)`; the default is the modern 538-college
 * threshold), they win outright. Otherwise returns null so resolution can run
 * a House/Senate contingent election (269–269 ties, third-party blocks, etc.).
 *
 * @param electoralVotesByCandidate - Output of `allocateElectoralVotes`
 * @returns Winner candidate ID and their EV count, or null for contingent election
 */
export function determinePresidentialWinner(
  electoralVotesByCandidate: Record<string, number>,
  evNeeded: number = ELECTORAL_MAJORITY
): { winnerId: string; winnerEV: number } | null {
  const ranked = Object.entries(electoralVotesByCandidate).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;

  const [winnerId, winnerEV] = ranked[0];

  if (winnerEV >= evNeeded) {
    return { winnerId, winnerEV };
  }

  return null;
}

/**
 * Compute winner share for a multi-seat race (house, stateSenate).
 *
 * Candidates above MIN_SHARE of total votes each win one seat. Seats are
 * awarded in descending order until totalSeats is reached.
 *
 * @param voteTotals - Map of candidateId → vote count
 * @param totalSeats - Total seats available
 * @param minShare - Minimum share of total votes required to win a seat (default 0.2)
 * @returns Array of winning candidate IDs (may be fewer than totalSeats if insufficient votes)
 */
export function determineMultiSeatWinners(
  voteTotals: Record<string, number>,
  totalSeats: number,
  minShare = 0.2
): string[] {
  const total = Object.values(voteTotals).reduce((s, v) => s + v, 0);
  if (total === 0) return [];

  const ranked = Object.entries(voteTotals).sort((a, b) => b[1] - a[1]);

  const winners: string[] = [];
  for (const [candidateId, votes] of ranked) {
    if (winners.length >= totalSeats) break;
    if (votes / total >= minShare) {
      winners.push(candidateId);
    }
  }
  return winners;
}
