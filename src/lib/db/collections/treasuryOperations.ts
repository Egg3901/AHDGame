import type { Db } from "mongodb";
import type { TreasuryOperation } from "@/lib/db/types/treasuryOperation";

export function getTreasuryOperationsCollection(db: Db) {
  return db.collection<TreasuryOperation>("treasuryOperations");
}
