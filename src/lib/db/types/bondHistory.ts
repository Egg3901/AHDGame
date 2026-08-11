import type { ObjectId } from "mongodb";

/**
 * Per-bond snapshot taken each turn during bond turn processing.
 * Used for price-over-time charts on the bond detail page.
 */
export interface BondHistory {
  _id: ObjectId;
  bondId: ObjectId;
  turn: number;
  marketPrice: number;
  /** Cumulative interest paid to all holders since issuance */
  totalInterestPaid: number;
  createdAt: Date;
}
