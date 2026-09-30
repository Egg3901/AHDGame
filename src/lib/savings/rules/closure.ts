/**
 * Closing a departing character's savings releases the claim to the household
 * pool. Bank backing returns to that pool; central-bank backing stays there.
 * The account remains as a zero-balance historical record.
 */
import { oid, type BankingTransition } from "@/lib/banking/rules/boundary";
import { isBankHolder, type SavingsAccountSnapshot } from "./accounts";

export function savingsClosureTransition(input: {
  account: SavingsAccountSnapshot;
  centralBankId: string;
  turn: number;
  liabilityRecognized: boolean;
  ownerExists: boolean;
  /** A historical orphan whose owner and holder have both been deleted. */
  holderMissing?: boolean;
}): BankingTransition {
  const { account, centralBankId, turn, liabilityRecognized, ownerExists } = input;
  const amount = Math.max(0, account.balance);
  const bankHeld = isBankHolder(account.holder);
  const key = `savings-close:${account.id}:${account.version}`;
  return {
    key,
    kind: "savings_owner_departure",
    turn,
    currency: account.currency,
    legs:
      liabilityRecognized && bankHeld && !input.holderMissing && amount > 0
        ? [
            {
              kind: "debit",
              amount,
              collection: "corporations",
              filter: { _id: oid(account.holder), "bankCharter.status": "active" },
              path: "bankCharter.cashReserves",
              note: "departing owner's backing leaves the bank",
            },
            {
              kind: "credit",
              amount,
              collection: "centralBanks",
              filter: { _id: centralBankId },
              path: "externalBroadMoney",
              note: "backing returns to the household pool",
            },
          ]
        : [],
    projections: [
      ...(liabilityRecognized && !input.holderMissing && amount > 0
        ? [
            {
              collection: bankHeld ? "corporations" : "centralBanks",
              filter: { _id: bankHeld ? oid(account.holder) : centralBankId },
              update: {
                $inc: {
                  [bankHeld ? "bankCharter.playerDeposits" : "householdSavingsLiability"]: -amount,
                },
              },
              note: "release the departing owner's savings liability",
            },
          ]
        : []),
      ...(ownerExists
        ? [
            {
              collection: "characters",
              filter: { _id: oid(account.ownerId) },
              update: {
                $set: {
                  [`currencyBalances.savings.${account.currency}`]: 0,
                  [`currencyBalances.pendingSavingsInterest.${account.currency}`]: 0,
                },
              },
              note: "clear the departing character's savings projection",
            },
          ]
        : []),
      {
        collection: "savingsAccounts",
        filter: { _id: oid(account.id), version: account.version, status: "frozen" },
        update: {
          $set: {
            balance: 0,
            accruedInterest: 0,
            status: "closed",
            lastSettlementKey: key,
            lastSettledTurn: turn,
            ...(input.holderMissing ? { closureWriteOff: amount } : {}),
          },
          $inc: { version: 1 },
        },
        note: "retain the closed account with no remaining claim",
      },
    ],
    event: {
      kind: "account.withdrawn",
      command: "savings.close",
      subjectType: "savingsAccount",
      subjectId: account.id,
      amount: -amount,
      statusAfter: "closed",
      ...(input.holderMissing ? { meta: { missingHolderWriteOff: amount } } : {}),
    },
  };
}
