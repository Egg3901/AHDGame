/**
 * Pure check: is this character a member of the IMF Board?
 *
 * Per design: "the two IMF Corp shareholders are admin characters; they form
 * the IMF Board". A character is on the Board iff they appear in the IMF
 * Corp's `shareholders` array as a `characterId` (corporation-shareholder
 * positions are excluded — only natural-person shareholders form the Board).
 */

import type { ObjectId } from "mongodb";
import type { Shareholder } from "@/lib/db/types/corporation";

export interface ImfBoardMembershipInputs {
  imfCorpShareholders: Shareholder[];
  characterId: ObjectId;
}

export function isImfBoardMember(inputs: ImfBoardMembershipInputs): boolean {
  for (const sh of inputs.imfCorpShareholders) {
    if (sh.characterId && sh.characterId.equals(inputs.characterId)) return true;
  }
  return false;
}
