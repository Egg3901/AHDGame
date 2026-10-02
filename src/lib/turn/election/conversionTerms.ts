/**
 * Terms the first election after a one-party-state conversion runs under.
 *
 * A conversion records them on the country's `pendingPostConversionElection`
 * marker, the post-conversion step stamps them on every snap race it opens,
 * and general resolution applies them through these two functions:
 *
 * - `voteSharePenalty` (forced conversions): the former ruling party's votes
 *   scale by `1 + penalty` before seats are allocated.
 * - `legacyReservationPct`: the former ruling party keeps at least that share
 *   of each region's seats, provided it stood a candidate there. A
 *   reservation cannot seat someone who never ran.
 *
 * Both are no-ops for every election without `conversionTerms`.
 */
import type { Election } from "@/lib/db/types";
import type { RankedCandidate, SeatAllocationResult } from "./seatAllocation";

export type ConversionTerms = NonNullable<Election["conversionTerms"]>;

type Allocation = Pick<
  SeatAllocationResult,
  "isMultiSeat" | "seatsEstimate" | "winners" | "losers"
>;

/**
 * The tally with the former ruling party's votes scaled by the forced-path
 * penalty, or null when the terms carry no penalty or the party has no votes.
 */
export function applyConversionVotePenalty(
  votes: Record<string, number>,
  partyOf: (candidateId: string) => string | undefined,
  terms: ConversionTerms | undefined
): Record<string, number> | null {
  const penalty = terms?.voteSharePenalty;
  if (!terms || typeof penalty !== "number" || penalty === 0) return null;
  const factor = Math.max(0, 1 + penalty);
  let changed = false;
  const adjusted: Record<string, number> = {};
  for (const [id, v] of Object.entries(votes)) {
    if (partyOf(id) === terms.formerRulingPartyId && v > 0) {
      adjusted[id] = v * factor;
      changed = true;
    } else {
      adjusted[id] = v;
    }
  }
  return changed ? adjusted : null;
}

/**
 * Lift the former ruling party to its reserved share of a multi-seat race.
 *
 * Seats move one at a time to the party's best-placed candidate, each taken
 * from the other party's winner holding the most seats (the weaker vote gives
 * way on a tie), so the rest of the result keeps its shape. `ranked` is the
 * eligible field, best first.
 */
export function applyLegacySeatFloor<T extends Allocation>(
  allocation: T,
  ranked: readonly RankedCandidate[],
  terms: ConversionTerms | undefined
): T {
  if (!terms || !allocation.isMultiSeat || !(terms.legacyReservationPct > 0)) return allocation;
  const party = terms.formerRulingPartyId;
  const recipient = ranked.find((c) => c.party === party);
  if (!recipient) return allocation;

  const partyOf = new Map(ranked.map((c) => [c.id, c.party]));
  const votesOf = new Map(ranked.map((c) => [c.id, c.votes]));
  const seats = new Map(allocation.winners);
  const total = allocation.winners.reduce((n, [, s]) => n + s, 0);
  const floorSeats = Math.min(total, Math.round((total * terms.legacyReservationPct) / 100));
  let held = allocation.winners.reduce((n, [id, s]) => n + (partyOf.get(id) === party ? s : 0), 0);
  if (held >= floorSeats) return allocation;

  while (held < floorSeats) {
    let donor: string | null = null;
    for (const [id, n] of seats) {
      if (n <= 0 || partyOf.get(id) === party) continue;
      const best = donor === null ? 0 : (seats.get(donor) ?? 0);
      if (
        donor === null ||
        n > best ||
        (n === best && (votesOf.get(id) ?? 0) < (votesOf.get(donor) ?? 0))
      ) {
        donor = id;
      }
    }
    if (donor === null) break;
    seats.set(donor, (seats.get(donor) ?? 0) - 1);
    seats.set(recipient.id, (seats.get(recipient.id) ?? 0) + 1);
    held++;
  }

  const winners: [string, number][] = [...seats.entries()].filter(([, n]) => n > 0);
  const winnerIds = new Set(winners.map(([id]) => id));
  const losers = [
    ...allocation.losers.filter((id) => !winnerIds.has(id)),
    ...allocation.winners.map(([id]) => id).filter((id) => !winnerIds.has(id)),
  ];
  const seatsEstimate = { ...allocation.seatsEstimate };
  for (const [id, n] of seats) seatsEstimate[id] = n;
  return { ...allocation, winners, losers, seatsEstimate };
}
