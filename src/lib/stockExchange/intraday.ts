import type { Db } from "mongodb";
import type { MarketIndexIntraday } from "@/lib/db/types/marketIndexIntraday";
import type { MarketCapTick } from "@/lib/db/types/marketCapTick";

const QUARTER_MS = 15 * 60_000;

/** Start of the 15-minute slot containing `now` (UTC). */
export function quarterSlotStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / QUARTER_MS) * QUARTER_MS);
}

/**
 * Record one observed market-cap level per exchange for a turn and for its
 * 15-minute slot. Called on every snapshot rebuild (hourly turn processing
 * plus each quarter-hour market tick), so a turn accumulates up to ~5 prints,
 * high/low become the real observed extremes for candlestick charting, and
 * marketCapTicks carries one candle per exchange per quarter hour.
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
  levels = levels.filter((level) => Number.isFinite(level.marketCap) && level.marketCap >= 0);
  if (levels.length === 0) return;
  const col = db.collection<MarketIndexIntraday>("marketIndexIntraday");
  // The 15-minute series (marketCapTicks) gets the same print, keyed by slot.
  const at = quarterSlotStart(now);
  const slot = at.toISOString();
  await Promise.all([
    col.bulkWrite(
      levels.map(({ exchange, marketCap }) => {
        const cap = Math.round(marketCap);
        return {
          updateOne: {
            filter: { _id: `${exchange}:${turn}` },
            update: {
              $setOnInsert: { exchange, turn, open: cap },
              $max: { high: cap },
              $min: { low: cap },
              $set: { last: cap, updatedAt: now },
              $inc: { prints: 1 },
            },
            upsert: true,
          },
        };
      }),
      { ordered: false }
    ),
    db.collection<MarketCapTick>("marketCapTicks").bulkWrite(
      levels.map(({ exchange, marketCap }) => {
        const cap = Math.round(marketCap);
        return {
          updateOne: {
            filter: { _id: `${exchange}:${slot}` },
            update: {
              $setOnInsert: { exchange, at, open: cap },
              $max: { high: cap },
              $min: { low: cap },
              $set: { turn, last: cap, updatedAt: now },
              $inc: { prints: 1 },
            },
            upsert: true,
          },
        };
      }),
      { ordered: false }
    ),
  ]);
}
