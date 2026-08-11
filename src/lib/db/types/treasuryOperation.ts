import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/** One launched debt-management operation (active window). */
export interface DebtOperation {
  launchedTurn: number;
  expiresTurn: number;
  launchedBy: ObjectId | null;
  launchedByName: string;
  /** Snapshot of DEBT_OP_CONFIDENCE_BOOST_PER_TURN at launch (pts/turn). */
  boostPerTurn: number;
}

/** Past operation, stamped when an active op expires. */
export interface DebtOperationHistory {
  launchedTurn: number;
  expiresTurn: number;
  launchedBy: ObjectId | null;
  launchedByName: string;
}

/** Singleton per country (`_id = countryId`). Created lazily on first launch. */
export interface TreasuryOperation {
  _id: string; // countryId
  countryId: CountryId;
  activeOp: DebtOperation | null;
  /** Earliest turn a new op may be launched. */
  cooldownUntilTurn: number;
  history: DebtOperationHistory[];
  createdAt: Date;
  updatedAt: Date;
}
