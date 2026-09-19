import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Pre-computed stock exchange listing data, generated once per turn.
 * Avoids expensive queries when Discord bot or UI requests stock data.
 *
 * Currency semantics (v0.2.6):
 *   - `sharePrice`, `totalRevenue`, `income`, `marketCap` render as the
 *     corp's `liquidCurrencyCode` (exposed here as `liquidCurrencyCode`).
 *     UI passes the code as `nativeCurrencyCode` to `formatAmount` so the
 *     wallet preference still governs final display.
 *   - `*Anchor` siblings hold the same values normalized to ₳. Used for:
 *     (a) cross-corp sort (so sorting "Revenue" doesn't rank a JPY corp
 *         ahead of a USD corp purely due to denomination), and
 *     (b) cross-corp aggregates (admin market-cap totals, stockmarket
 *         headline stats) that sum across listings with different
 *         currencies.
 *   Pre-forex listings (no `liquidCurrencyCode` on the corp) passthrough
 *   — the anchor and local fields are equal.
 */
export interface StockExchangeListing {
  _id: ObjectId;
  sequentialId: number;
  name: string;
  /**
   * Stock ticker symbol copied from the source corporation. Absent on
   * pre-ticker legacy corps; UI falls back to the corp name.
   */
  tickerSymbol?: string;
  type: string;
  typeLabel: string;
  headquartersState: string;
  headquartersStateName: string;
  logoUrl?: string;
  brandColor?: string;
  dividendRate: number;
  sharePrice: number;
  totalShares: number;
  marketCap: number;
  totalRevenue: number;
  income: number;
  /**
   * Currency that `sharePrice` / `marketCap` / `totalRevenue` / `income`
   * are denominated in. Missing on pre-forex listings; UI treats that
   * as "render in player's wallet preference only."
   */
  liquidCurrencyCode?: CurrencyCode | null;
  /** Anchor (₳) mirrors for cross-corp sort + aggregation. */
  sharePriceAnchor?: number;
  marketCapAnchor?: number;
  totalRevenueAnchor?: number;
  incomeAnchor?: number;
  priceChange1h: number;
  priceChange24h: number;
  priceChange48h: number;
  avgSectorGrowth: number;
  /** Shares available in the public float (0 = no shares on market) */
  publicFloat: number;
  /**
   * Venue this corporation is listed on ("NYSE", "GOSPLAN", …). `null` when the
   * corp's country has no configured venue — such corps appear in the `global`
   * snapshot only, never on another country's exchange.
   */
  exchange: string | null;
  isNatcorp: boolean;
  /**
   * Present when isNatcorp — the countryId of the nation that owns this
   * state-owned enterprise. Drives the by-nation grouping in the stock list
   * UI (a country can own a dozen+ SoEs; the UI collapses them into one
   * expandable row per nation rather than ~15 flat sibling rows).
   */
  countryOwnerId?: string;
  /**
   * True when the corp is NPP-run (ceoType === "npp"). NPP corps are
   * economically negligible flavor (~0.09% of total market cap); the UI sorts
   * them below player corps and hides them by default behind a toggle (t834).
   */
  isNpp?: boolean;
  /** True when another corporation holds over 50% of shares */
  isSubsidiary?: boolean;
  /** Present when isSubsidiary — controlling corporate parent name */
  subsidiaryParentName?: string;
  ceo: {
    name: string;
    avatarUrl?: string;
    sequentialId?: number;
  } | null;
}

export interface StockExchangeSnapshot {
  /** Exchange API key (e.g. "nyse", "ftse", "nikkei", "tsx", "dax") or "global" */
  _id: string;
  /** Turn when this snapshot was generated */
  turn: number;
  /** Exchange display name */
  exchangeName: string;
  /** Pre-computed listings sorted by market cap descending */
  listings: StockExchangeListing[];
  /**
   * Count of privately-held corporations (isPrivate: true, not
   * hiddenFromExchange) scoped to this exchange — 0 if none. These corps
   * exist (players see them founded via the wire ticker) but never appear
   * in `listings` until they IPO; the UI surfaces this count so the absence
   * reads as "private, not yet listed" rather than "broken."
   */
  unlistedPrivateCount?: number;
  /** When this snapshot was created */
  createdAt: Date;
}
