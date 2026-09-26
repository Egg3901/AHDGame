import type { Db } from "mongodb";
import type { MarketIndexIntraday } from "@/lib/db/types/marketIndexIntraday";

/**
 * Record one observed market-cap level per exchange for a turn. Called on
 * every snapshot rebuild (hourly turn processing plus each 15-minute
 * refresh), so a turn accumulates up to ~5 prints and high/low become the
 * real observed extremes for candlestick charting.
 *
 * Pure additive write: no pricing input, no snapshot logic, safe to call from
 * any rebuild path. Levels are raw anchor market cap so cross-currency venue
 * sums stay comparable.
 */
export async function recordIntradayLevels(
  db: Db,
  turn: number,
  levels: { exchange: string; marketCap: number }[],
  now: Date
): Promise<void> {
  if (levels.length === 0) return;
  const col = db.collection<MarketIndexIntraday>("marketIndexIntraday");
  await Promise.all(
    levels.map(({ exchange, marketCap }) => {
      const cap = Math.round(marketCap);
      return col.updateOne(
        { _id: `${exchange}:${turn}` },
        {
          $setOnInsert: { exchange, turn, open: cap },
          $max: { high: cap },
          $min: { low: cap },
          $set: { last: cap, updatedAt: now },
          $inc: { prints: 1 },
        },
        { upsert: true }
      );
    })
  );
}
