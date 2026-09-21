import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";

export type CurrencyOrderType = "market" | "limit" | "direct";
export type CurrencyOrderStatus =
  "open" | "processing" | "filled" | "partial" | "cancelled" | "expired";

export interface ForexFillSpreadLegIntent {
  fee: number;
  sourceCountry: CountryId;
  currency: CurrencyCode;
  destCountry?: CountryId;
  /** Central-bank revenue slice, per the shared spread split. */
  revenue: number;
  /** Foreign-reserve slice, per the shared spread split. */
  reserve: number;
  /** True when revenue and reserve land on the same bank document. */
  sameBank: boolean;
}

export interface ProcessingFillTradeIntent {
  buyerCharacterId: string;
  sellerCharacterId: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  amount: number;
  rate: number;
  spread: number;
  turn: number;
  createdAt: Date;
}

/**
 * Durable intent for a peer-filled limit order, written atomically with the
 * open/partial to processing claim. A later attempt can finish or undo the
 * fill from this record alone, without recomputing from moved balances.
 * Keyed stable per fill: `forex-fill:{orderId}:{filledAmountBefore}`.
 */
export interface ProcessingFillIntent {
  /** Stable idempotency key, also the trade-history row `_id`. */
  key: string;
  /** Per-claim nonce: leg stamps embed it so a re-claim after a rollback
   * never mistakes the rolled-back attempt's stamps for its own. */
  nonce: string;
  orderId: string;
  fillerId: string;
  posterId: string;
  statusBefore: "open" | "partial";
  filledAmountBefore: number;
  fillAmount: number;
  newFilledAmount: number;
  newStatus: "filled" | "partial";
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  toCurrencyAmount: number;
  posterSpread: number;
  fillerSpread: number;
  fillerTotalCost: number;
  spreadLegs: ForexFillSpreadLegIntent[];
  trade: ProcessingFillTradeIntent;
  turn: number;
  claimedAt: Date;
  /** Crash-recovery ownership: set when a rollback starts, with a timestamp
   * so a dead recoverer does not block the next one past the stale window. */
  recoveryKey?: string;
  recoveryAt?: Date;
}

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
  /** Durable peer-fill intent, present only while status is `processing`
   * for a peer fill claimed on the non-transactional path. Cleared by the
   * final flip or by a rollback restore. */
  processingFillKey?: string;
  processingFill?: ProcessingFillIntent;
  filledRate?: number;
  /** Cumulative spread charged across all fill tranches */
  spreadCharged: number;
  createdAt: Date;
  updatedAt: Date;
}
