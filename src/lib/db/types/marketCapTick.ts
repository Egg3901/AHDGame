/**
 * Market capitalization per exchange per 15-minute slot. One document per
 * exchange-slot, written on every snapshot rebuild (the hourly turn plus the
 * :15/:30/:45 market ticks). Feeds the 15-minute candles on the market cap
 * chart. Kept permanently: about four small rows per exchange per hour.
 *
 * Raw anchor market cap, the same basis as marketIndexIntraday.
 */
export interface MarketCapTick {
  /** `${exchange}:${slot ISO}` */
  _id: string;
  /** Exchange api key (`global`, or `sector:<type>` for the sector series). */
  exchange: string;
  /** Last completed turn when the slot was recorded. */
  turn: number;
  /** Slot start, floored to the quarter hour (UTC). */
  at: Date;
  open: number;
  high: number;
  low: number;
  last: number;
  prints: number;
  updatedAt: Date;
}
