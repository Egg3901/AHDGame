import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";

/** Public intervention band info for the exchange page. Reserves stay hidden. */
export interface PublicInterventionBand {
  floor: number;
  ceiling: number;
  setAtTurn: number;
  defending: boolean;
}

/** Exchange rate as returned by GET /api/forex/exchange */
export interface ExchangeRateDisplay {
  countryId: CountryId;
  currencyCode: CurrencyCode;
  rate: number;
  baseRate: number;
  rateHistory: { turn: number; value: number }[];
  /** Strength vs calibration/base rate. Positive = currency stronger, negative = weaker. */
  strengthVsBase: number;
  buyVolume24?: number;
  sellVolume24?: number;
  interventionBand?: PublicInterventionBand | null;
}

/** One of the top reserve currencies, as returned by GET /api/forex/exchange */
export interface ReserveLeaderDisplay {
  currencyCode: CurrencyCode;
  /** 1-based rank by FX reserve volume (1 = leading exchange currency). */
  rank: number;
  /** Total face units of this currency held as FX reserves across all central banks. */
  units: number;
  /** Value of `units` in the internal anchor (₳), for display-currency conversion. */
  internalValue: number;
  /** True for rank 1 — the leading exchange currency (carries the largest buff). */
  isLeading: boolean;
  /** Per-turn volatility reduction from the rank buff (0.5 = −50%; 0 = no buff). */
  volatilityReduction: number;
}

/** Cross-rate between two currencies, derived client-side */
export interface CrossRate {
  from: CurrencyCode;
  to: CurrencyCode;
  rate: number;
  change24h: number;
}

/** Order as returned by GET /api/forex/orders and GET /api/forex/exchange */
export interface OrderDisplay {
  _id: string;
  characterId: string;
  characterName: string;
  type: "market" | "limit" | "direct";
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  amount: number;
  limitRate?: number;
  targetCharacterName?: string;
  expiresAtTurn?: number;
  status: "open" | "partial" | "filled" | "cancelled" | "expired";
  filledAmount: number;
  filledRate?: number;
  spreadCharged: number;
  createdAt: string;
}

/** Player's currency wallet balances */
export interface WalletBalances {
  campaign: number;
  personal: Partial<Record<CurrencyCode, number>>;
  homeCurrency: CurrencyCode;
  /** High-yield savings per currency (forex v1: USD/GBP/JPY) */
  savings?: Partial<Record<CurrencyCode, number>>;
  savingsAccountsOpened?: Partial<Record<CurrencyCode, boolean>>;
  apyByCurrency?: Partial<Record<CurrencyCode, number>>;
  /** Lifetime interest credited to balance per currency (after quarterly credit). */
  interestEarned?: Partial<Record<CurrencyCode, number>>;
  /** Accrued interest not yet credited to savings balance (forex path). */
  pendingSavingsInterest?: Partial<Record<CurrencyCode, number>>;
  /** Turns until pending interest is credited to savings (1–12). */
  turnsUntilSavingsCredit?: number;
  /** Estimated interest accrual for the current turn per currency (based on balance × APY). */
  estimatedSavingsAccrualPerTurn?: Partial<Record<CurrencyCode, number>>;
}

/** Tab options for the exchange page */
export type ForexTab = "rates" | "policy" | "orders" | "history" | "feed";

/** Macro chart metric on the policy tab */
export type MacroMetric = "inflation" | "interest" | "gdp";

/** Per-country snapshots for global monetary policy chart */
export interface CountryMacroSnapshot {
  countryId: CountryId;
  currencyCode: CurrencyCode;
  primeRate: number | null;
  interestRateHistory: { turn: number; value: number }[];
  inflationHistory: { turn: number; value: number }[];
  gdpGrowthHistory: { turn: number; value: number }[];
}
