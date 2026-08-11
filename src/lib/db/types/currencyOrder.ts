import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";

export type CurrencyOrderType = "market" | "limit" | "direct";
export type CurrencyOrderStatus =
  "open" | "processing" | "filled" | "partial" | "cancelled" | "expired";

export interface CurrencyOrder {
  _id: ObjectId;
  characterId: ObjectId;
  characterName: string;
  countryId: CountryId;
  type: CurrencyOrderType;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  /** Amount of fromCurrency to spend */
  amount: number;
  /** Limit orders — worst acceptable rate */
  limitRate?: number;
  /** 'buy' = acquire toCurrency, 'sell' = acquire fromCurrency at this rate */
  direction?: "buy" | "sell";
  /** Direct orders only — target character */
  targetCharacterId?: ObjectId;
  targetCharacterName?: string;
  expiresAtTurn?: number;
  status: CurrencyOrderStatus;
  filledAmount: number;
  filledRate?: number;
  /** Cumulative spread charged across all fill tranches */
  spreadCharged: number;
  createdAt: Date;
  updatedAt: Date;
}
