/**
 * Prior-cycle seat-share lookup for the swing-flow incumbency driver.
 *
 * Implements A1 from `2026-05-22-swing-flow-driver-activation.md` (option δ
 * — share-weighted incumbency). The codebase models proportional-from-
 * vote-share allocation for multi-seat races (US House, UK Regional
 * Council, JP Shugiin/Sangiin, DE Bundestag, etc), so "incumbent" is not
 * a single ID but a per-party seat-share map.
 *
 * Single-seat races do NOT use this fallback: `totalVotes` holds raw per-
 * candidate vote counts, so a single-seat share map is just the prior vote
 * split (e.g. 0.52 / 0.45), which the incumbency driver would turn into a
 * meaningless margin-scaled value. Executives use the approval curve
 * (`incumbentPartyId`) and US Senate uses the flat shield
 * (`legislativeIncumbentPartyId`); both bypass this map.
 */

import type { Db } from "mongodb";
import type { Election, ElectionVoteTally } from "@/lib/db/types";
import { getElectionSeatKey } from "@/lib/turn/autoReelectionEntry";

/**
 * Compute per-party vote share from a resolved tally's raw votes. Pure
 * function — exported for unit testing without a database.
 *
 * Sums each party's candidates' votes, normalizes by the grand total.
 * Returns a Map summing to 1.0 (within rounding) when totalVotes is
 * positive, empty Map otherwise.
 */
export function computeSeatShareFromTally(
  totalVotes: Record<string, number>,
  candidateParties: Record<string, string>
): Map<string, number> {
  const partyVotes = new Map<string, number>();
  let grandTotal = 0;
  for (const [candidateId, votes] of Object.entries(totalVotes)) {
    if (!Number.isFinite(votes) || votes <= 0) continue;
    const party = candidateParties[candidateId];
    if (!party) continue;
    partyVotes.set(party, (partyVotes.get(party) ?? 0) + votes);
    grandTotal += votes;
  }
  if (grandTotal <= 0) return new Map();
  const shares = new Map<string, number>();
  for (const [party, votes] of partyVotes) {
    shares.set(party, votes / grandTotal);
  }
  return shares;
}

/**
 * Look up the prior-cycle seat-share map for a given election. Returns
 * an empty Map when there is no prior resolved election on the same
 * seat key (first-ever race, no historical data, etc.) — the swing-flow
 * driver treats an empty map as "no incumbent" and returns 0.
 *
 * Strategy:
 *   1. Compute the current election's seat key.
 *   2. Find resolved elections sharing the same seat key, prior cycle.
 *   3. Take the most-recent one's `ElectionVoteTally`.
 *   4. Reduce to per-party vote-share via `computeSeatShareFromTally`.
 */
export async function getIncumbentSeatShareByParty(
  election: Election,
  db: Db
): Promise<Map<string, number>> {
  const seatKey = getElectionSeatKey(election);

  // Find resolved elections in this country+state in prior cycles. We
  // intentionally do NOT filter on `electionType` in the DB query: snap
  // elections (`snap_commons`, `snap_bundestag`, `snap_shugiin`) share a
  // seat key with their regular counterparts (`commons` / `bundestag` /
  // `shugiin`) via `getElectionSeatKey`'s canonicalization through
  // `officeKeyForElectionType`. A snap-followed-by-regular cycle on the
  // same seat must match. The in-memory `find` filter below applies the
  // canonical seat-key match.
  const priorElections = await db
    .collection<Election>("elections")
    .find({
      countryId: election.countryId ?? "US",
      state: election.state,
      status: "resolved",
      cycle: { $lt: election.cycle },
    })
    .sort({ cycle: -1 })
    .toArray();

  const prior = priorElections.find((p) => getElectionSeatKey(p) === seatKey);
  if (!prior) return new Map();

  const tally = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .findOne({ electionId: prior._id });
  if (!tally || !tally.finalized) return new Map();

  return computeSeatShareFromTally(tally.totalVotes, tally.candidateParties);
}
