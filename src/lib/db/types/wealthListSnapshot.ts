/**
 * Pre-computed wealth list snapshot, generated once per turn (hourly).
 * Stores ranked entries per exchange so the API can serve them instantly
 * and compute 24h changes by comparing with the snapshot from 24 turns ago.
 */

export interface WealthListEntry {
  characterId: string;
  sequentialId: number | null;
  name: string;
  avatarUrl: string | null;
  state: string;
  country: string;
  corporation: string | null;
  stockValue: number;
  bondValue: number;
  /**
   * `stockValue + bondValue`. This is a WIDER definition than the
   * `portfolioValue` on `investorRankingSnapshot` and in
   * `lib/character/financialData`, both of which are equities only. The wealth
   * list renders it beside its own Stocks and Bonds columns, which is what makes
   * the combined meaning read correctly there. Do not assume the three agree.
   */
  portfolioValue: number;
  cashValue: number;
  /** LOC debt subtracted from cash + portfolio to produce net worth. */
  locDebtValue?: number;
  /** Net worth after debt, used for ranking and display. */
  totalWealth: number;
  /** 1-based rank within this exchange snapshot */
  rank: number;
}

export interface WealthListSnapshot {
  /** "nyse" | "ftse" | "global" */
  _id: string;
  /** Turn when this snapshot was generated */
  turn: number;
  /** Ranked wealth entries */
  entries: WealthListEntry[];
  /** When this snapshot was created */
  createdAt: Date;
}
