import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Tracks the Discord bot's blackjack prize pool - an infinite fund that pays out winnings.
 * Initialized at $200M, increased by player losses, decreased by player wins.
 *
 * When forex is enabled, balances are tracked per-currency to avoid mixing currencies.
 * All wagers and payouts use the player's home currency.
 */
export interface DiscordBotFund {
  _id: ObjectId;
  /** Single document with _id: "blackjack_prize_pool" */
  name: "blackjack_prize_pool";
  /** Legacy balance field - deprecated when forex enabled. Use currencyBalances instead. */
  balance: number;
  /** Per-currency balances - used when forex is enabled. Only includes currencies with non-zero balances. */
  currencyBalances?: Partial<Record<CurrencyCode, number>>;
  /** Total amount wagered (lifetime handle), tracked per-currency when forex enabled */
  totalWagered: number;
  /** Total paid out to winners (lifetime), net of house edge */
  totalPaidOut: number;
  /** Total collected from losers (lifetime) */
  totalCollected: number;
  /** Number of games played */
  gamesPlayed: number;
  createdAt: Date;
  updatedAt: Date;
}
