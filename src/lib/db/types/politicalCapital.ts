import type { ObjectId } from "mongodb";

export type CapitalActionType =
  | "request_endorsement"
  | "private_meeting"
  | "boost_favorability"
  | "reduce_favorability"
  | "boost_influence"
  | "reduce_influence";

/**
 * Append-only audit log of player→NPP interaction attempts. There is no
 * `outcome` (success / failure / backfire) — these actions are deterministic
 * and either complete fully or reject at the gate.
 *
 * `effectSummary` is a human-readable description of what changed; the
 * machine-readable diff lives in the per-collection writes the action triggers
 * (NPPRelationship update, NPPEndorsement insert, NPP stat updates, etc.).
 */
export interface CapitalActionLog {
  _id: ObjectId;
  characterId: ObjectId;
  nppId: ObjectId;
  action: CapitalActionType;

  actionsSpent: number;
  fundsSpent: number;

  relationshipBefore: number;
  relationshipAfter: number;

  effectSummary: string;

  /** Optional contextual ids (e.g. candidacyId for endorsement). */
  context: {
    candidacyId?: ObjectId;
  };

  turn: number;
  createdAt: Date;
}
