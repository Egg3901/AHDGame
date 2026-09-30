/** Optional original-quote receipt for LOC residual conversions; normal FX is unchanged. */
import { type Db, type Document, ObjectId } from "mongodb";
import { isDeepStrictEqual } from "node:util";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import {
  SPREAD_FEE_FOREX_REVENUE_RATIO,
  SPREAD_FEE_RESERVE_RATIO,
} from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { loadLocSettlement, locReceiptId, settleLocPlan } from "@/lib/lineOfCredit/settlement";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";

export interface ReceiptRequest {
  characterId: ObjectId;
  commandId: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  amount: number;
  turn: number;
}
const request = (p: ReceiptRequest) => ({
  operation: "residual_fx",
  characterId: p.characterId.toHexString(),
  fromCurrency: p.fromCurrency,
  toCurrency: p.toCurrency,
  amount: p.amount,
  turn: p.turn,
});
export const marketReceiptKey = (p: ReceiptRequest) => `loc:fx:${p.characterId}:${p.commandId}`;
export async function replayMarketMakerReceipt(db: Db, p: ReceiptRequest) {
  const original = await loadLocSettlement(db, marketReceiptKey(p));
  if (!original) return null;
  if (!isDeepStrictEqual(original.locSettlement.request, request(p)))
    throw new Error("Residual FX identity belongs to another request");
  if (original.status === "rejected") return original.locSettlement.effect.result;
  const settled = await settleLocPlan(db, original._id, original.turn, original.locSettlement);
  return settled.error
    ? {
        success: false,
        error: settled.error,
        fromAmount: p.amount,
        toAmount: 0,
        effectiveRate: 0,
        spreadCharged: 0,
      }
    : settled.result;
}
export async function settleMarketMakerReceipt(
  db: Db,
  p: ReceiptRequest,
  quote: {
    fromCountryId: CountryId;
    toCountryId: CountryId;
    spend: number;
    received: number;
    rate: number;
    fee: number;
    trade: Document;
  }
) {
  const key = marketReceiptKey(p),
    tradeHistoryId = locReceiptId(key, "trade");
  const revenue = Math.round(quote.fee * SPREAD_FEE_FOREX_REVENUE_RATIO),
    reserve = Math.round(quote.fee * SPREAD_FEE_RESERVE_RATIO);
  const result = {
    success: true,
    fromAmount: quote.spend,
    toAmount: quote.received,
    effectiveRate: quote.rate,
    spreadCharged: quote.fee,
    tradeHistoryId,
  };
  const settled = await settleLocPlan(db, key, p.turn, {
    characterId: p.characterId,
    expectedRevision: null,
    request: request(p),
    createdAt: new Date(),
    extraRecords: [
      { collection: "tradeHistory", document: { ...quote.trade, _id: tradeHistoryId } },
    ],
    effect: {
      walletInc: {
        [`currencyBalances.personal.${p.fromCurrency}`]: -quote.spend,
        [`currencyBalances.personal.${p.toCurrency}`]: quote.received,
      },
      reserves: [
        ...(revenue !== 0
          ? [
              {
                bankId: getBankId(quote.fromCountryId),
                increments: { forexRevenue: revenue },
                createIfMissing: true,
              },
            ]
          : []),
        ...(reserve > 0
          ? [
              {
                bankId: getBankId(quote.toCountryId),
                increments: { [`spreadFeeReserveBalances.${p.fromCurrency}`]: reserve },
                createIfMissing: true,
              },
            ]
          : []),
      ],
      ledger: [],
      transactions: [],
      flows: [
        {
          currency: p.fromCurrency,
          kind: "debit",
          amount: quote.spend,
          note: "Original residual FX source wallet",
        },
        {
          currency: p.fromCurrency,
          kind: "burn",
          amount: quote.spend - quote.fee,
          note: "Source currency converted at original FX quote",
        },
        {
          currency: p.toCurrency,
          kind: "mint",
          amount: quote.received,
          note: "Destination currency delivered at original FX quote",
        },
        {
          currency: p.toCurrency,
          kind: "credit",
          amount: quote.received,
          note: "Original residual FX destination wallet",
        },
        {
          currency: p.fromCurrency,
          kind: "credit",
          amount: revenue,
          note: "Source central-bank spread revenue",
        },
        {
          currency: p.fromCurrency,
          kind: "credit",
          amount: reserve,
          note: "Destination central-bank foreign reserve",
        },
        {
          currency: p.fromCurrency,
          kind: "burn",
          amount: quote.fee - revenue - reserve,
          note: "Original spread sink",
        },
      ].filter((flow) => flow.amount > 0),
      result,
    },
  });
  return settled.error
    ? { ...result, success: false, error: settled.error, toAmount: 0 }
    : settled.result;
}
export async function recordMarketMakerRefusal(
  db: Db,
  p: ReceiptRequest,
  result: Record<string, unknown>
) {
  await db.collection<{ _id: string }>(MONEY_MOVE_COLLECTION).updateOne(
    { _id: marketReceiptKey(p) },
    {
      $setOnInsert: {
        kind: "line_of_credit",
        turn: p.turn,
        status: "rejected",
        error: result.error,
        legs: [],
        createdAt: new Date(),
        locSettlement: {
          characterId: p.characterId,
          expectedRevision: null,
          request: request(p),
          createdAt: new Date(),
          effect: { walletInc: {}, reserves: [], ledger: [], transactions: [], flows: [], result },
        },
      },
    },
    { upsert: true }
  );
  return (await replayMarketMakerReceipt(db, p))!;
}
