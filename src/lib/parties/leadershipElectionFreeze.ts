/**
 * Transfer freeze over the closing turns of a party leadership election.
 *
 * A turn is one hour, so this is the last two hours before the result.
 * That is the window where an outgoing officer has both the motive and
 * the last opportunity to move money before losing the seat, and where
 * the incoming officer cannot yet act.
 *
 * Unlike the payout cap, this is a hard stop rather than a rate limit,
 * and it applies regardless of who the recipient is. It also does not
 * care whether anyone is standing: the freeze is about the handover, not
 * about the contest.
 *
 * Chair, Vice-Chair and Treasurer elections share an `endTurn` per cycle
 * in practice, so this is normally one two-turn window per cycle rather
 * than three.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NationalPartyElection, PoliticalParty } from "@/lib/db/types";

/** How many turns before an election closes the freeze begins. */
export const LEADERSHIP_FREEZE_TURNS = 2;

/** Player-facing message for a transfer refused by the freeze. */
export const LEADERSHIP_FREEZE_MESSAGE =
  "A party leadership election closes within two turns. Party transfers are paused until the result is in.";

/**
 * True when any of this party's leadership elections is open and closes
 * within `LEADERSHIP_FREEZE_TURNS`.
 *
 * An election already past its `endTurn` but still `"voting"` counts as
 * inside the window: an overdue result is the most sensitive moment, not
 * a reason to reopen transfers.
 */
export async function isLeadershipElectionFreezeActive(
  db: Db,
  party: Pick<PoliticalParty, "sequentialId"> & { countryId: CountryId },
  currentTurn: number
): Promise<boolean> {
  const closing = await db
    .collection<NationalPartyElection>("nationalPartyElections")
    .countDocuments(
      {
        partyId: String(party.sequentialId),
        countryId: party.countryId,
        status: "voting",
        endTurn: { $lte: currentTurn + LEADERSHIP_FREEZE_TURNS },
      },
      { limit: 1 }
    );
  return closing > 0;
}
