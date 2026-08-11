import type { ObjectId } from "mongodb";
import type { ProfileGeneral } from "@/lib/military/generalsTree";

/**
 * A character's standing in the general corps.
 *
 * The commission is deliberately separate from the profile. Becoming a general is an
 * appointment by the Secretary of Defense, but the career build stays the player's — so
 * a character can be commissioned before choosing a spec (`general: null`). Dismissal
 * clears the commission while retaining the profile, so re-appointing a veteran restores
 * their record instead of resetting them to level 1.
 */
export interface CharacterGeneralDoc {
  _id: ObjectId;
  characterId: string;
  /** The general profile. Null between commissioning and the appointee choosing a spec. */
  general: ProfileGeneral | null;
  /**
   * Whether the character currently holds a commission. Absent on documents written
   * before commissioning existed — see `isCommissioned`.
   */
  commissioned?: boolean;
  /** The Secretary of Defense who commissioned them, for the record. */
  commissionedByCharacterId?: string;
  commissionedTurn?: number;
  dismissedTurn?: number;
}

/**
 * Whether a stored doc represents a live commission.
 *
 * Only an explicit `false` means dismissed; an absent field is a pre-commissioning
 * document and reads as commissioned, so nobody loses a commission they already hold.
 * `?? true` rather than a truthiness check — otherwise a deliberately dismissed general
 * would be silently restored.
 */
export function isCommissioned(doc: Pick<CharacterGeneralDoc, "commissioned">): boolean {
  return doc.commissioned ?? true;
}
