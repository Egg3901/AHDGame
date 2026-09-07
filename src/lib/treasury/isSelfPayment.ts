/**
 * Shared self-dealing check for treasury payouts.
 *
 * Used by the party, state party and caucus send routes. Each of those
 * either has no second signature available at all, or (for the national
 * party treasury) uses this to force a payment to the actor through the
 * two-person approval workflow instead of executing it immediately.
 */

import type { ObjectId } from "mongodb";
import type { Character } from "@/lib/db/types";

/**
 * True when `recipient` is the acting player themselves.
 *
 * Compares the character AND the owning account. A character-only check
 * is not enough: nothing in the schema stops one account holding a second
 * character in the same party (`characters.userId` has a non-unique
 * index), and an officer could then pay an alt to sidestep the rule.
 * No account currently holds two characters, so this is defence in depth
 * rather than a fix for something live.
 *
 * NPP characters carry no owning account, so the account comparison is
 * skipped when either side is missing rather than matching on undefined.
 */
export function isSelfPayment(
  recipient: Pick<Character, "_id" | "userId">,
  actor: { characterId: ObjectId; userId: string | null | undefined }
): boolean {
  if (recipient._id.equals(actor.characterId)) return true;
  if (recipient.userId == null || actor.userId == null) return false;
  return String(recipient.userId) === String(actor.userId);
}
