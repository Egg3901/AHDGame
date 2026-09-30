/** Correct only the sub-nanounit residue caused by an old full-withdrawal guard. */
import { oid, type BankingTransition } from "@/lib/banking/rules/boundary";
import { isBankHolder, type SavingsAccountSnapshot } from "./accounts";

export function savingsRoundingRepair(
  account: SavingsAccountSnapshot,
  centralBankId: string,
  turn: number
): BankingTransition | null {
  if (account.status !== "open" || !(account.balance < 0 && account.balance >= -1e-9)) return null;
  const residue = -account.balance;
  const bankHeld = isBankHolder(account.holder);
  const key = `savings-rounding:${account.id}:${account.version}`;
  return {
    key,
    kind: "savings_rounding_repair",
    currency: account.currency,
    turn,
    legs: [],
    projections: [
      {
        collection: bankHeld ? "corporations" : "centralBanks",
        filter: { _id: bankHeld ? oid(account.holder) : centralBankId },
        update: {
          $inc: {
            [bankHeld ? "bankCharter.playerDeposits" : "householdSavingsLiability"]: residue,
          },
        },
        note: "match the liability to the zero claim after rounding repair",
      },
      {
        collection: "characters",
        filter: {
          _id: oid(account.ownerId),
          [`currencyBalances.savings.${account.currency}`]: account.balance,
        },
        update: { $set: { [`currencyBalances.savings.${account.currency}`]: 0 } },
        note: "normalize the matching legacy rounding residue",
      },
      {
        collection: "savingsAccounts",
        filter: { _id: oid(account.id), version: account.version, balance: account.balance },
        update: {
          $set: { balance: 0, lastSettlementKey: key, lastSettledTurn: turn },
          $inc: { version: 1 },
        },
        note: "normalize a previously overdrawn floating-point residue",
      },
    ],
    event: {
      kind: "account.deposited",
      command: "savings.rounding_repair",
      subjectType: "savingsAccount",
      subjectId: account.id,
      amount: residue,
      meta: { roundingAdjustment: residue, cashMoved: 0 },
    },
  };
}
