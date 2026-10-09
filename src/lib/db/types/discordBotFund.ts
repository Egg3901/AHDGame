import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";

/** Lifetime figures for one casino game, in anchor units. */
export interface CasinoGameStats {
  handleAnchor: number;
  paidOutAnchor: number;
  played: number;
}

/**
 * The Discord casino house bank (originally the blackjack prize pool, and
 * still stored under that name). Seeded at 200M, grown by player losses and
 * drawn down by wins. See `src/lib/casino/house.ts`.
 *
 * Solvency is `anchorBalance`. The per-currency buckets and legacy totals
 * predate it and are kept for history only.
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
  /** House bank in anchor units. Back-filled from `currencyBalances` on first casino use. */
  anchorBalance?: number;
  /** Per-game lifetime figures. */
  games?: Partial<Record<string, CasinoGameStats>>;
  createdAt: Date;
  updatedAt: Date;
}
