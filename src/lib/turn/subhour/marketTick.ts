import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { applyPriceMultipliers } from "@/lib/corporations/applyPriceMultipliers";
import { recomputeSharePricesAfterBondTurn } from "@/lib/turn/corporation/recomputeSharePrices";
import { generateStockExchangeSnapshots } from "@/lib/turn/stockExchangeSnapshot";
import { runInAuditContext } from "@/lib/observability/context";

export interface MarketTickResult {
  turn: number;
  corpsRepriced: number;
  corpsSkipped: number;
  pricesUpdated: number;
  pulseCount: number;
  ms: number;
}

/**
 * Quarter-hour market tick (:15, :30 and :45; the turn covers :00).
 *
 * 1. Re-price every company's fundamental value from what moved inside the
 *    hour: cash after player actions, bond holdings and debt, exchange rates,
 *    prime rates, index ownership. Earnings stay at the last turn's value
 *    because production only runs on the turn.
 * 2. Apply sentiment and order flow on top, as the 15-minute refresh always did.
 * 3. Rebuild exchange snapshots, which also records the 15-minute market cap
 *    point (marketCapTicks) and the turn's intraday high/low.
 *
 * The turn's own price chain is untouched: corporationHistory is not written
 * and the next turn smooths against the same prior it would have without
 * ticks. Returns null when the world is inactive or a live turn holds the lock.
 */
export async function runMarketTick(
  now: Date = new Date(),
  db?: Db
): Promise<MarketTickResult | null> {
  const database = db ?? (await getDb());
  const started = Date.now();
  const state = await database.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        currentTurn: 1,
        isActive: 1,
        isProcessing: 1,
        processingHeartbeatAt: 1,
        processingStartedAt: 1,
        processingPhase: 1,
        processingTargetTurn: 1,
        processingAbandonedAt: 1,
        updatedAt: 1,
      },
    }
  );
  if (!state?.isActive) return null;
  // A stale heartbeat does not prove the previous writer has stopped.
  // Lock recovery belongs to the turn processor.
  if (state.isProcessing) return null;

  const turn = state.currentTurn;
  return runInAuditContext(`market-tick:${turn}:${now.toISOString()}`, async () => {
    const { corpsRepriced, corpsSkipped } = await recomputeSharePricesAfterBondTurn(
      turn,
      database,
      { intraHour: true }
    );
    const { updated, pulseCount } = await applyPriceMultipliers(database);
    await generateStockExchangeSnapshots(turn, database);
    await database
      .collection<GameState>("gameState")
      .updateOne({ _id: "current" }, { $set: { lastMarketTickAt: now } });
    return {
      turn,
      corpsRepriced,
      corpsSkipped,
      pricesUpdated: updated,
      pulseCount,
      ms: Date.now() - started,
    };
  });
}
