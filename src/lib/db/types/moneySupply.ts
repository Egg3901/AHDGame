import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import type { MoneyAggregates } from "@/lib/moneySupply/calculate";

export interface MoneySupplySnapshot extends MoneyAggregates {
  _id: string;
  turn: number;
  countryId: CountryId;
  bankId: string;
  currencyCode: CurrencyCode;
  /** Null when the observation window is shorter than a game-quarter. */
  annualizedM2GrowthPct: number | null;
  netMoneyCreatedLifetime: number;
  createdAt: Date;
}

export type MonetaryOperationType = "qe" | "qt" | "treasury_advance" | "liquidity_injection";

export interface MonetaryOperationRecord {
  type: MonetaryOperationType;
  turn: number;
  amount: number;
  moneySupplyDelta: number;
  reserveDelta: number;
  bondId?: string;
  units?: number;
  actorName: string;
  reason?: string;
  createdAt: Date;
  /**
   * Chartered banks that took a share of a liquidity injection. Zero means no
   * bank could take it and the cash buffered the central bank's reserve pool
   * instead (the pre-1.1 behaviour, now the fallback).
   */
  banksCredited?: number;
}

export type MonetaryPolicyDecision = MonetaryOperationType | "hold";

export interface MonetaryPolicyEvaluation {
  turn: number;
  decision: MonetaryPolicyDecision;
  rationale: string;
  inflation: number;
  targetInflation: number;
  gdpGrowth: number;
  annualizedM2GrowthPct: number;
  moneyGrowthReliable: boolean;
  bankReserves: number;
  gdp: number;
  createdAt: Date;
}
