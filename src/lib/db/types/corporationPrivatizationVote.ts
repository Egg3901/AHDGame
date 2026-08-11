import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "../../constants/currencies";

export interface PrivatizationVoteCast {
  /** Character holder, present for character-owned positions */
  characterId?: ObjectId;
  /** Corporation holder, present for corp-owned positions */
  corporationId?: ObjectId;
  /** Share count at the moment this vote was cast (re-read on each cast — no snapshot) */
  voteShares: number;
  vote: "yes" | "no";
  castAt: Date;
}

export interface CorporationPrivatizationVote {
  _id: ObjectId;
  corporationId: ObjectId;
  /** Character that opened the vote (must be CEO at open time) */
  openedByCharacterId: ObjectId;
  openedAtTurn: number;
  /** openedAtTurn + PRIVATIZATION_VOTE_DURATION_TURNS */
  deadlineAtTurn: number;
  /** Per-share buyout price locked at vote-open time = currentSharePrice × (1 + PRIVATIZATION_BUYOUT_PREMIUM) */
  lockedBuyoutPrice: number;
  lockedBuyoutCurrency: CurrencyCode;
  /** Worst-case payout, atomically debited from CEO at open and refunded on fail/cancel */
  totalReservedCash: number;
  reservedCashCurrency: CurrencyCode;
  votes: PrivatizationVoteCast[];
  status: "open" | "passed" | "failed" | "cancelled";
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
