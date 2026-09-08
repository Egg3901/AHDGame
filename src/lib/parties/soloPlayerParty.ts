/**
 * Solo-player detection for the treasury approval workflow.
 *
 * Two-person approval needs two people. A party whose only member is a
 * single player has nobody to countersign, so it would be permanently
 * unable to move its own money. Such a party runs in single mode and
 * may self-fund.
 *
 * NPP members do not count: they hold seats and swell `memberCount`,
 * but nothing drives them to click Approve. They live in their own
 * `npps` collection, so counting `characters` counts players only —
 * `memberCount` on the party is characters + NPPs and must NOT be used
 * for this.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Character, PoliticalParty } from "@/lib/db/types";

/**
 * True when the party has at most one player member.
 *
 * Counts at most two documents: we only need to know whether a second
 * player exists, not how many there are.
 */
export async function isSoloPlayerParty(
  db: Db,
  party: Pick<PoliticalParty, "sequentialId"> & { countryId: CountryId }
): Promise<boolean> {
  const players = await db
    .collection<Character>("characters")
    .countDocuments(
      { party: String(party.sequentialId), countryId: party.countryId },
      { limit: 2 }
    );
  return players <= 1;
}
