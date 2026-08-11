import type { ObjectId } from "mongodb";

/**
 * Per-character per-state organization investment for presidential primaries.
 * `level` (0–10) multiplies the candidate's per-state vote weight during
 * presidential primary stagger waves (capped at `MAX_STATE_ORG_BONUS_PRIMARY` at
 * level 10). `totalInvested` is a career running tally preserved across the
 * partial-25% reset on Presidential General resolve — used for veterans
 * achievements and to distinguish freshly-built vs post-reset levels.
 *
 * Keyed by the compound (characterId, stateId). A unique compound index on
 * `{ characterId, stateId }` is recommended in production but not enforced
 * at the type layer.
 */
export interface CharacterStateOrg {
  _id: ObjectId;
  characterId: ObjectId;
  stateId: string;
  level: number;
  totalInvested: number;
  updatedAt: Date;
}
