import type { CorporationType } from "@/lib/constants/corporations";

export interface StockListing {
  _id: string;
  sequentialId: number;
  name: string;
  /** Stock ticker symbol; absent on pre-ticker legacy corps. */
  tickerSymbol?: string;
  type: CorporationType;
  typeLabel: string;
  headquartersState: string;
  headquartersStateName: string;
  logoUrl?: string;
  /** Hex brand color when set on the corporation; charts fall back to a hash-based color if unset */
  brandColor?: string;
  /** Dividend rate 0–100 (percent of income distributed) */
  dividendRate?: number;
  sharePrice: number;
  totalShares: number;
  marketCap: number;
  totalRevenue: number;
  income: number;
  /** Currency code for sharePrice/marketCap/totalRevenue/income (v0.2.6). */
  liquidCurrencyCode?: string | null;
  /** ₳-normalized mirrors used for cross-currency sorting. */
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
   * Venue this corporation lists on. `null` when its country has no configured
   * venue — those corps surface on the global board only. Mirrors
   * `StockExchangeListing.exchange`; keep the two in sync.
   */
  exchange: string | null;
  isNatcorp?: boolean;
  /** Present when isNatcorp — nation that owns this SoE; drives by-nation grouping. */
  countryOwnerId?: string;
  /** True when the corp is NPP-run; hidden from the list by default (t834). */
  isNpp?: boolean;
  isSubsidiary?: boolean;
  subsidiaryParentName?: string;
  ceo: {
    name: string;
    avatarUrl?: string;
    sequentialId?: number;
  } | null;
}

export interface ExchangeData {
  exchange: string;
  exchangeName: string;
  listings: StockListing[];
  /**
   * Count of privately-held corporations that exist on this exchange's
   * country/scope but never IPO'd, so they don't appear in `listings`.
   * Surfaced in the UI so a low listing count reads as "most corps here are
   * private" rather than "the page is broken."
   */
  unlistedPrivateCount?: number;
}

export interface CommodityData {
  commodity: string;
  label: string;
  icon: string;
  colors: string;
  unit: string;
  basePrice: number;
  globalPrice: number;
  globalSupply: number;
  globalDemand: number;
  exchangeSupply: number;
  exchangeDemand: number;
  priceChange: number;
  recentPriceChange?: number | null;
  annualPriceChange?: number;
  /** Per-state prices restricted to the selected exchange's country (empty on global view). */
  statePrices?: Record<string, number>;
  /** Per-state supply matching `statePrices`, used to volume-weight national averages. */
  stateSupply?: Record<string, number>;
  /** Per-state demand (scope=full only) — pairs with stateSupply for the State lens. */
  stateDemand?: Record<string, number>;
  /** Per-country supply/demand/price (scope=full only) — drives the Country lens. */
  nationalSupply?: Record<string, number>;
  nationalDemand?: Record<string, number>;
  nationalPrices?: Record<string, number>;
  /**
   * Per-country reachable market book (scope=full only) — drives the Reachable
   * lens, which is the one a build decision should use. `demand` is what this
   * country's sellers can actually reach; `blockedSupply`/`untradedSupply` are
   * disclosure only and must never enter a ratio (ticket #1077).
   */
  reachableBooks?: Record<
    string,
    { supply: number; demand: number; blockedSupply: number; untradedSupply: number }
  >;
  turn: number;
}

export interface MarketCapPoint {
  turn: number;
  marketCap: number;
  /** Simulated intra-turn high for candlestick charting (absent on old records) */
  high?: number;
  /** Simulated intra-turn low for candlestick charting (absent on old records) */
  low?: number;
  bySector?: Partial<Record<CorporationType, number>>;
}

export interface MarketHistoryResponse {
  points: MarketCapPoint[];
  newestTurnDate: string | null;
}

export type StockTab =
  "stocks" | "commodities" | "bonds" | "wealth" | "stats" | "funds" | "auctions";

export interface WealthEntry {
  rank: number;
  characterId: string;
  sequentialId: number | null;
  name: string;
  avatarUrl: string | null;
  borderKey?: string | null;
  tintColor?: string | null;
  state: string;
  country: string;
  corporation: string | null;
  stockValue: number;
  bondValue: number;
  portfolioValue: number;
  cashValue: number;
  locDebtValue?: number;
  totalWealth: number;
  /** Dollar change in totalWealth over the last 24h (null if no prior data) */
  wealthChange24h: number | null;
  /** Rank positions moved: positive = moved up, negative = moved down (null if no prior data) */
  rankChange24h: number | null;
}

export interface BondListing {
  _id: string;
  issuerType?: "corporation" | "sovereign";
  countryId?: string;
  /**
   * Canonical bond denomination (`bond.currencyCode` post-Task-18B). UI
   * consumers must pass this to `formatPrice(pricePerUnit, currencyCode)` /
   * `formatPrice(marketPrice × BOND_UNIT_FACE_VALUE, currencyCode)` so
   * LOCAL values render correctly under the viewer's wallet preference.
   */
  currencyCode?: string | null;
  corporationId: string;
  corporationName: string;
  corporationSequentialId?: number;
  logoUrl?: string;
  brandColor?: string;
  corporationType?: CorporationType;
  couponRate: number;
  pricePerUnit?: number;
  maturityLabel: string;
  maturityTurns: number;
  turnsRemaining: number;
  marketPrice: number;
  totalIssued: number;
  publicFloat: number;
  totalUnits: number;
  totalUnitsHeld: number;
  defaulted: boolean;
  holders: number;
  yieldToMaturity: number;
}

export type SortField =
  | "marketCap"
  | "sharePrice"
  | "income"
  | "name"
  | "revenue"
  | "priceChange"
  | "publicFloat"
  | "tickerSymbol";
export type SortDir = "asc" | "desc";
export type ExchangeFilter = "global" | (string & {});
export type WealthSortField =
  "totalWealth" | "stockValue" | "bondValue" | "portfolioValue" | "cashValue";
export type WealthSortDir = "asc" | "desc";
