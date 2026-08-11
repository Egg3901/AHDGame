/**
 * Sainte-Laguë (divisor) method for proportional seat allocation.
 *
 * Used for:
 * - German Bundestag federal allocation (630 seats to parties)
 * - German state-level list distribution (per-Land allocation to parties)
 *
 * Algorithm: Divide each party's vote share by divisors 1, 3, 5, 7, ... (odd numbers)
 * and allocate seats to the highest quotients in descending order until seats are exhausted.
 */

export interface VoteShare {
  partyId: string;
  votes: number;
}

export interface SeatAllocationResult {
  partySeats: Record<string, number>;
  totalAllocated: number;
}

/**
 * Allocates seats proportionally using Sainte-Laguë (divisor method).
 *
 * @param voteShares - Array of { partyId, votes }
 * @param totalSeats - Number of seats to allocate
 * @param options - { minVoteShare?: 0.05, minDirectMandates?: 0 }
 *   minVoteShare: parties below this % of total votes are filtered out (default 0.05 = 5%)
 *   minDirectMandates: if a party has >= this many direct mandate wins, it bypasses minVoteShare
 * @returns { partySeats, totalAllocated }
 */
export function allocateViaSainteLague(
  voteShares: VoteShare[],
  totalSeats: number,
  options: {
    minVoteShare?: number;
    minDirectMandates?: Record<string, number>;
  } = {}
): SeatAllocationResult {
  const { minVoteShare = 0.05, minDirectMandates = {} } = options;

  // Compute total votes and filter by threshold
  const totalVotes = voteShares.reduce((sum, v) => sum + v.votes, 0);
  const threshold = minVoteShare * totalVotes;

  const eligible = voteShares.filter((v) => {
    const hasEnoughVotes = v.votes >= threshold;
    const hasEnoughDirectMandates = (minDirectMandates[v.partyId] ?? 0) >= 3;
    return hasEnoughVotes || hasEnoughDirectMandates;
  });

  if (eligible.length === 0) {
    return { partySeats: {}, totalAllocated: 0 };
  }

  // Initialize allocation tracking
  const allocation: Record<string, number> = {};
  for (const { partyId } of eligible) {
    allocation[partyId] = 0;
  }

  // Sainte-Laguë: iteratively allocate seats to parties with highest quotient
  for (let seatIdx = 0; seatIdx < totalSeats; seatIdx++) {
    let bestPartyId: string | null = null;
    let bestQuotient = 0;

    for (const { partyId, votes } of eligible) {
      const divisor = 2 * allocation[partyId] + 1; // 1, 3, 5, 7, ...
      const quotient = votes / divisor;

      if (quotient > bestQuotient) {
        bestQuotient = quotient;
        bestPartyId = partyId;
      }
    }

    if (bestPartyId === null) break; // Should not happen with valid input

    allocation[bestPartyId]++;
  }

  const totalAllocated = Object.values(allocation).reduce((sum, s) => sum + s, 0);

  return {
    partySeats: allocation,
    totalAllocated,
  };
}

/**
 * Verify that allocation sums to expected total (for debugging / assertions).
 */
export function validateAllocation(result: SeatAllocationResult, expectedTotal: number): boolean {
  return result.totalAllocated === expectedTotal;
}
