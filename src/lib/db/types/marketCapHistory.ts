import type { CorporationType } from "../../constants/corporations";

/**
 * Historical snapshot of total market capitalization per turn.
 * One document per turn, storing aggregate market cap by exchange and sector.
 * Values are based on reported (fog-of-war) share quotes.
 * Used for the market cap tracker chart on the stock market page.
 */
export interface MarketCapHistory {
  turn: number;
  /** Aggregate eligibility rule used for this row. Absent on legacy all-corporation rows. */
  listingUniverse?: "public-only";
  /** Total market cap across all exchanges (close value for the turn) */
  globalMarketCap: number;
  /** Continuity-adjusted index level; raw capitalization remains above. */
  globalMarketIndex?: number;
  /** Simulated intra-turn peak for the continuity-adjusted index. */
  globalMarketIndexHigh?: number;
  /** Simulated intra-turn trough for the continuity-adjusted index. */
  globalMarketIndexLow?: number;
  /** Divisor used to absorb listed-constituent removals. */
  globalMarketIndexDivisor?: number;
  /** Raw capitalization removed from the prior index universe this turn. */
  removedMarketCap?: number;
  /** Simulated intra-turn peak for candlestick charting */
  globalHigh?: number;
  /** Simulated intra-turn trough for candlestick charting */
  globalLow?: number;
  /** Market cap for NYSE (US-headquartered corporations) */
  nyseMarketCap: number;
  nyseHigh?: number;
  nyseLow?: number;
  /** Market cap for FTSE (UK-headquartered corporations) */
  ftseMarketCap: number;
  ftseHigh?: number;
  ftseLow?: number;
  /** Per-exchange market cap data (new format — preferred over named fields above) */
  exchangeCaps?: Record<
    string,
    {
      marketCap: number;
      high: number;
      low: number;
      marketIndex?: number;
      marketIndexDivisor?: number;
      removedMarketCap?: number;
      marketIndexHigh?: number;
      marketIndexLow?: number;
    }
  >;
  /** Market cap broken down by sector type */
  bySector: Partial<Record<CorporationType, number>>;
  createdAt: Date;
}
