import type { ObjectId } from "mongodb";
import type { CrisisEffect } from "./crisis";

/** One head-of-state aid pledge against a crisis, awaiting its legislature vote. */
export interface CrisisAidCommitment {
  _id: ObjectId;
  crisisId: ObjectId;
  billId: ObjectId;
  senderCountryId: string;
  proposerCharacterId: ObjectId;
  proposerName: string;
  amountLocal: number;
  amountPctGdp: number;
  /** Recovery effects applied to the crisis scope at pledge time (for exact reversal). */
  recoveryEffects: CrisisEffect[];
  /** Diplomatic effects applied to the sender's approval at pledge time. */
  senderEffects: CrisisEffect[];
  treasuryDebited: number;
  status: "pending" | "passed" | "failed";
  /** Set on a failed vote: turn at/after which the -AID_FAILED_PENALTY reverses. */
  approvalPenaltyExpiresTurn?: number;
  penaltyReversed?: boolean;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
}
