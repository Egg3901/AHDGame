/**
 * Prior-cycle seat-share lookup for the swing-flow incumbency driver.
 *
 * Implements A1 from `2026-05-22-swing-flow-driver-activation.md` (option δ
 * — share-weighted incumbency). The codebase models proportional-from-
 * vote-share allocation for multi-seat races (US House, UK Regional
 * Council, JP Shugiin/Sangiin, DE Bundestag, etc), so "incumbent" is not
 * a single ID but a per-party seat-share map.
 *
 * Races with their own OFFICEHOLDER incumbency path do NOT use this fallback:
 * `totalVotes` holds raw per-candidate vote counts, so for a single winner the
 * map is just the prior vote split (e.g. 0.52 / 0.45), which the incumbency
 * driver would turn into a meaningless margin-scaled value. Single-winner
 * executives use the approval curve (`incumbentPartyId`) and the US Senate uses
 * the flat shield (`legislativeIncumbentPartyId`); both bypass this map, and
 * both correctly go quiet on a vacant seat.
 *
 * That exclusion is enforced by {@link usesSeatShareIncumbency} inside
 * `getIncumbentSeatShareByParty` itself. It used to live only at the call
 * sites, and only covered the US Senate — so a single-winner EXECUTIVE race
 * whose officeholder path went quiet (a vacant seat) silently fell through to
 * this map. See that helper's doc for the live regression it caused, and for
 * the one case still left on the seat-share path by design.
 */

import type { Db } from "mongodb";
import type { Election, ElectionVoteTally } from "@/lib/db/types";
import { getElectionSeatKey } from "@/lib/turn/autoReelectionEntry";
import { SINGLE_WINNER_EXECUTIVE_ELECTION_TYPES } from "@/lib/constants/countries";
import { isSingleSeatLegislativeRace } from "./singleSeatIncumbency";

/**
 * False for the races that have a dedicated OFFICEHOLDER incumbency path, so
 * they must never fall back to a prior-cycle vote split:
 *   - single-winner executives ({@link SINGLE_WINNER_EXECUTIVE_ELECTION_TYPES})
 *     — the `incumbentPartyId` approval curve
 *   - the US Senate ({@link isSingleSeatLegislativeRace}) — the
 *     `legislativeIncumbentPartyId` flat shield
 *
 * For those races `totalVotes` is a two-way vote split, not a seat split, so
 * the map would price a margin nobody in the current race earned. Crucially,
 * when the seat is VACANT both officeholder paths are correctly unset, and the
 * driver must then read 0 (open seat) — NOT fall through to this map.
 *
 * Regression this guards (live FL Governor, cycle 5): a vacant FL Governor seat
 * left `incumbentPartyId` unset, so the driver read the prior race's 72/28
 * vote split as a seat share and handed a party that had never held the office
 * a -7.2pt "Incumbency" drag.
 *
 * True otherwise — chambers whose seats are allocated from vote share (US
 * House, UK Regional Council, JP Shugiin/Sangiin, DE Bundestag, …), where the
 * map's entries really are seats each party is defending.
 *
 * KNOWN RESIDUAL, deliberately not covered here: a race can be multi-seat by
 * TYPE but single-seat in one region (US House in a one-district state such as
 * VT / WY / AK; BR `chamber`, seeded at `totalSeats: 1`). There the map also
 * degenerates to a vote split. It is left alone because, unlike a vacant
 * executive seat, those races have a real sitting incumbent, so zeroing the
 * driver would remove incumbency rather than correct it — a balance change
 * needing its own issue and simulation report, not a defect fix. Gate on
 * `totalSeats` here if that is ever taken on.
 */
export function usesSeatShareIncumbency(election: Election): boolean {
  if (SINGLE_WINNER_EXECUTIVE_ELECTION_TYPES.has(election.electionType)) return false;
  // Country-scoped: BR reuses the "senate" type for 3-seat PR races, which DO
  // want the map. `isSingleSeatLegislativeRace` already makes that distinction.
  if (isSingleSeatLegislativeRace(election)) return false;
  return true;
}

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
 *   0. Bail out for races that must not use a seat-share map at all
 *      ({@link usesSeatShareIncumbency}).
 *   1. Compute the current election's seat key.
 *   2. Find resolved elections sharing the same seat key, prior cycle.
 *   3. Take the most-recent one's `ElectionVoteTally`.
 *   4. Reduce to per-party vote-share via `computeSeatShareFromTally`.
 */
export async function getIncumbentSeatShareByParty(
  election: Election,
  db: Db
): Promise<Map<string, number>> {
  // Guarded here rather than at each call site so no caller can reintroduce
  // the single-winner fallback by forgetting the check. Also saves the two
  // round-trips below on every executive / US Senate race.
  if (!usesSeatShareIncumbency(election)) return new Map();

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
