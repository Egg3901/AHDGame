/**
 * Intraday index levels per exchange and turn. One document per
 * exchange-turn, refreshed on every snapshot rebuild (hourly turn plus each
 * 15-minute refresh) via $max/$min, so high/low are real observed extremes —
 * never the simulated spreads stored on marketCapHistory.
 *
 * Raw anchor market cap, not the continuity-adjusted index: constituent
 * changes genuinely move total capitalization, and candles must show it.
 */
export interface MarketIndexIntraday {
  /** `${exchange}:${turn}` */
  _id: string;
  /** Exchange api key (`global` for the worldwide aggregate). */
  exchange: string;
  turn: number;
  /** First observed level this turn. */
  open: number;
  /** Max observed level this turn. */
  high: number;
  /** Min observed level this turn. */
  low: number;
  /** Most recent observed level this turn. */
  last: number;
  /** Snapshot rebuilds contributing to this row. */
  prints: number;
  updatedAt: Date;
}
