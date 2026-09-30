/** Plain account values shared by savings commands and owner-departure settlement. */
import type { SavingsAccount } from "@/lib/db/types/savingsAccount";
import type { SavingsAccountSnapshot } from "./rules/accounts";
function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
export function toAccountSnapshot(doc: SavingsAccount): SavingsAccountSnapshot {
  return {
    id: doc._id.toString(),
    ownerType: doc.ownerType,
    ownerId: doc.ownerId.toString(),
    currency: doc.currency,
    balance: finite(doc.balance),
    holder: doc.holder,
    status: doc.status,
    version: finite(doc.version),
    accruedInterest: finite(doc.accruedInterest),
    interestEarned: finite(doc.interestEarned),
    lastSettlementKey: doc.lastSettlementKey,
    lastSettledTurn: doc.lastSettledTurn,
    openedTurn: finite(doc.openedTurn),
  };
}
