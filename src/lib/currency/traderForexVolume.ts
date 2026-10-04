/**
 * How much a character has converted through their own trades over the volume
 * lookback, in ₳. Where their next trade starts on the size-fee curve
 * (see tradeFees.ts), so splitting a large conversion into small ones does not
 * escape the fee.
 *
 * Only player-initiated trades count: income that the game converts for them
 * (dividends, coupons, purchase shortfalls) is not a choice to move money.
 */
import type { Db, ObjectId } from "mongodb";
import { VOLUME_LOOKBACK_TURNS } from "@/lib/constants/currencies";
import type { ExchangeRate, TradeHistoryEntry, TradeSource } from "@/lib/db/types";

export const PLAYER_TRADE_SOURCES: ReadonlySet<TradeSource> = new Set<TradeSource>([
  "manual",
  "api",
  "limit_order",
]);

/** Legacy rows carry no source and were all manual trades. */
export function isPlayerTradeSource(source: TradeSource | undefined | null): boolean {
  return source == null || PLAYER_TRADE_SOURCES.has(source);
}

export async function loadTraderRecentForexAnchor(
  db: Db,
  characterId: ObjectId,
  currentTurn: number
): Promise<number> {
  const since = Math.max(1, currentTurn - VOLUME_LOOKBACK_TURNS);
  const rows = await db
    .collection<TradeHistoryEntry>("tradeHistory")
    .find(
      {
        buyerCharacterId: characterId,
        turn: { $gte: since },
        $or: [{ source: { $exists: false } }, { source: { $in: [...PLAYER_TRADE_SOURCES] } }],
      },
      { projection: { amount: 1, anchorAmount: 1, fromCurrency: 1 } }
    )
    .toArray();
  if (rows.length === 0) return 0;

  // Rows written before anchorAmount existed are valued at today's rate.
  let rateByCode: Map<string, number> | null = null;
  if (rows.some((row) => !(Number.isFinite(row.anchorAmount) && (row.anchorAmount ?? 0) > 0))) {
    const rates = await db
      .collection<ExchangeRate>("exchangeRates")
      .find({}, { projection: { currencyCode: 1, rate: 1 } })
      .toArray();
    rateByCode = new Map(rates.map((r) => [r.currencyCode, r.rate]));
  }

  let total = 0;
  for (const row of rows) {
    if (Number.isFinite(row.anchorAmount) && (row.anchorAmount ?? 0) > 0) {
      total += row.anchorAmount as number;
      continue;
    }
    const rate = rateByCode?.get(row.fromCurrency);
    if (rate && rate > 0 && Number.isFinite(row.amount) && row.amount > 0) {
      total += row.amount / rate;
    }
  }
  return total;
}
