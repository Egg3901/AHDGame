/**
 * Treasurer-election lockout for the vacant-seat approval fallback.
 *
 * `resolveTransactionApprovalMode` collapses a party's "double" mode to
 * "single" whenever the Treasurer seat is vacant, so a party isn't
 * permanently locked out of its own treasury. That fallback is safe
 * while nobody is standing for Treasurer, but it hands a lame-duck
 * Chair unilateral spending power in exactly the window where a
 * Treasurer is about to take office and start co-signing.
 *
 * This module detects that window: an open Treasurer election closing
 * within `TREASURER_LOCKOUT_TURNS`, with at least one candidate still
 * standing. While it holds, the fallback is suppressed and outbound
 * treasury actions stay under two-person approval (which, with the
 * seat vacant, means they're frozen until the winner is seated).
 *
 * If nobody is running, the election can't seat anyone, so the
 * fallback stays active and the party keeps functioning.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NationalPartyCandidate, NationalPartyElection, PoliticalParty } from "@/lib/db/types";

/**
 * How close an open Treasurer election must be to its `endTurn` before
 * the vacant-seat fallback is suppressed.
 */
export const TREASURER_LOCKOUT_TURNS = 6;

/**
 * True when this party's approval mode would collapse from "double" to
 * "single" purely because the Treasurer seat is empty.
 *
 * Callers use this to skip the lockout lookup entirely: a party with a
 * seated Treasurer, or one that deliberately voted itself into single
 * mode, is unaffected by the lockout either way, so there is nothing to
 * query.
 */
export function wouldUseVacantTreasurerFallback(
  party: Pick<PoliticalParty, "transactionApprovalMode" | "treasurerId">
): boolean {
  return (party.transactionApprovalMode ?? "double") === "double" && party.treasurerId == null;
}

/**
 * True when a contested Treasurer election is within
 * `TREASURER_LOCKOUT_TURNS` of closing for this party.
 *
 * An election already past its `endTurn` but still `"voting"` counts as
 * inside the window — an overdue race is the most sensitive moment of
 * all, not a reason to reopen the fallback.
 *
 * Returns false (fallback stays available) when there is no open
 * Treasurer election, when the closest one is still further out than
 * the window, or when no candidate is standing in it.
 */
export async function isTreasurerElectionLockoutActive(
  db: Db,
  party: Pick<PoliticalParty, "sequentialId"> & { countryId: CountryId },
  currentTurn: number
): Promise<boolean> {
  const closing = await db
    .collection<NationalPartyElection>("nationalPartyElections")
    .find({
      partyId: String(party.sequentialId),
      countryId: party.countryId,
      position: "treasurer",
      status: "voting",
      endTurn: { $lte: currentTurn + TREASURER_LOCKOUT_TURNS },
    })
    .toArray();
  if (closing.length === 0) return false;

  // A race nobody entered will seat nobody, so the fallback is still
  // the only thing keeping the party's treasury usable.
  const standing = await db
    .collection<NationalPartyCandidate>("nationalPartyCandidates")
    .countDocuments({
      electionId: { $in: closing.map((election) => election._id) },
      status: "active",
    });

  return standing > 0;
}

/** Player-facing message for a treasury action refused by the lockout. */
export const TREASURER_LOCKOUT_MESSAGE =
  "A Treasurer election is closing shortly. Outbound treasury transfers are paused until the new Treasurer is seated.";
