import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { SavingsHolder } from "@/lib/db/types/bank";

/**
 * Collection: savingsAccounts. The authoritative record of one owner's
 * savings in one currency.
 *
 * Until this existed a player's savings were a number on the character
 * document plus a pointer saying which bank "held" them, and the bank never
 * received the cash. This record makes the balance, the holder and the cash
 * behind it one thing: a bank-held account is a real liability of that bank,
 * backed by cash that moved out of the central bank's household pool when
 * the holder changed, and it comes back the same way.
 *
 * The character's `currencyBalances.savings` and `savingsHolder` fields are
 * projections of this record during the migration; the account is what the
 * commands read and write.
 */
export type SavingsAccountOwnerType = "character" | "npp";

export type SavingsAccountStatus =
  /** Normal. Deposits, withdrawals and transfers allowed. */
  | "open"
  /** The holder is being resolved; no movements until the resolution lands. */
  | "frozen"
  /** Closed with a zero balance. Kept for history. */
  | "closed";

export interface SavingsAccount {
  _id: ObjectId;
  ownerType: SavingsAccountOwnerType;
  ownerId: ObjectId;
  currency: CurrencyCode;
  /** The owner's claim, in currency face value. Never negative. */
  balance: number;
  /** Who owes the balance: the central bank, or a bank corporation id (hex). */
  holder: SavingsHolder;
  status: SavingsAccountStatus;
  /** Optimistic-concurrency version. Every command bumps it by one. */
  version: number;
  /** Interest accrued since the last credit, not yet in `balance`. */
  accruedInterest: number;
  /** Lifetime interest credited to this account. */
  interestEarned: number;
  /** Settlement lineage: the last journal key that changed this record. */
  lastSettlementKey?: string;
  lastSettledTurn?: number;
  openedTurn: number;
  /** Set when the record was materialized from legacy character fields. */
  migratedFromLegacyAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
