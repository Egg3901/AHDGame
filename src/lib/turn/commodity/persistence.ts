import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";
import { marketAtLeast } from "@/lib/market/featureFlag";
import { buildCommodityFlowDocs, COMMODITY_FLOW_RETENTION_TURNS } from "@/lib/market/flowLedger";
import { clearAllCommodities } from "@/lib/trade/snapshot";
import { valueTradeSnapshot } from "@/lib/trade/snapshot";
import { serializeReachableBooks } from "@/lib/trade/reachableBook";
import type { buildReachableBooks } from "@/lib/trade/reachableBook";
import type { PlantsUnits } from "./ledgerTypes";
import type { CountryLedger, GlobalLedger } from "./ledgerTypes";
import { buildPriceHistoryDocs } from "./pricing";

export interface TurnPersistenceInputs {
  marketSystemMode: Parameters<typeof marketAtLeast>[0];
  global: GlobalLedger;
  byCountry: CountryLedger;
  demandTruncated: Map<CommodityType, number>;
  appliedGlobalPrices: Map<CommodityType, number>;
  appliedStatePrices: Map<CommodityType, Record<string, number>>;
  appliedNationalPrices: Map<CommodityType, Record<string, number>>;
  scarcityMultByCommodity: Map<CommodityType, number>;
  ledgerBasePrices: Record<CommodityType, number>;
  commodityNominalPriceIndex: number;
  stockCoverCapEnabled: boolean;
  plantsUnitsByCommodity?: Map<CommodityType, PlantsUnits>;
  tradeClearing: ReturnType<typeof clearAllCommodities>;
  reachableBooks: ReturnType<typeof buildReachableBooks>;
  countries: CountryId[];
}

/**
 * Persistence tail: price history snapshots, the commodity flow ledger, and
 * the valued trade-flow snapshot. Write shapes are unchanged (upsert by
 * {commodity, turn} / {turn} so cron retries overwrite rather than append).
 * Returns the total cleared trade value for the turn result.
 */
export async function persistTurnOutputs(
  db: Db,
  inputs: TurnPersistenceInputs,
  turn: number,
  now: Date
): Promise<{ tradeClearedVolume: number }> {
  const {
    marketSystemMode,
    global,
    byCountry,
    demandTruncated,
    appliedGlobalPrices,
    appliedStatePrices,
    appliedNationalPrices,
    scarcityMultByCommodity,
    ledgerBasePrices,
    commodityNominalPriceIndex,
    stockCoverCapEnabled,
    plantsUnitsByCommodity,
    tradeClearing,
    reachableBooks,
    countries,
  } = inputs;

  // Store price history snapshots for charting — uses the actual applied price
  // (including drift, pegs, and nudges) so charts match what players see.
  const historyDocs = buildPriceHistoryDocs({
    global,
    demandTruncated,
    appliedGlobalPrices,
    appliedStatePrices,
    appliedNationalPrices,
    scarcityMultByCommodity,
    ledgerBasePrices,
    commodityNominalPriceIndex,
    turn,
    now,
  });
  // Upsert by {commodity, turn} so cron retries overwrite rather than append.
  if (historyDocs.length > 0) {
    await db.collection("commodityPriceHistory").bulkWrite(
      historyDocs.map((doc) => ({
        replaceOne: {
          filter: { commodity: doc.commodity, turn: doc.turn },
          replacement: doc,
          upsert: true,
        },
      }))
    );
  }

  // Prune history older than 5 game years (240 turns) to cap storage
  const pruneCutoff = turn - 240;
  if (pruneCutoff > 0) {
    await db.collection("commodityPriceHistory").deleteMany({ turn: { $lt: pruneCutoff } });
  }

  // ── Commodity flow ledger (marketSystemMode >= "ledger", audit t806 Fix 3/D0) ──
  // Shadow of the flows the current model implies: units supplied/demanded,
  // what would clear, unmet demand and unsold surplus, globally and per
  // country. Pure observability — no behaviour change; later ledger phases
  // (inventory, throughput coupling) build on these rows.
  if (marketAtLeast(marketSystemMode, "ledger")) {
    // Prior turn's stock rows seed this turn's inventory accumulation.
    const prevFlows = await db
      .collection("commodityFlows")
      .find({ turn: turn - 1 }, { projection: { commodity: 1, stockUnits: 1 } })
      .toArray();
    const prevStockByCommodity = new Map<CommodityType, number>(
      prevFlows
        .filter((f) => typeof f.stockUnits === "number")
        .map((f) => [f.commodity as CommodityType, f.stockUnits as number])
    );
    const flowDocs = buildCommodityFlowDocs({
      global,
      byCountry,
      globalPriceByCommodity: appliedGlobalPrices,
      nationalPricesByCommodity: appliedNationalPrices,
      prevStockByCommodity,
      coverCapEnabled: stockCoverCapEnabled,
      plantsUnitsByCommodity,
      turn,
      now,
    });
    if (flowDocs.length > 0) {
      // Lazy index for the {commodity} + latest-turn read path (commodity page)
      // and the upsert filter below. Fire-and-forget, same as wireEvent.
      void db
        .collection("commodityFlows")
        .createIndex({ commodity: 1, turn: -1 })
        .catch(() => {});
      // Upsert by {commodity, turn} so cron retries overwrite rather than append.
      await db.collection("commodityFlows").bulkWrite(
        flowDocs.map((doc) => ({
          replaceOne: {
            filter: { commodity: doc.commodity, turn: doc.turn },
            replacement: doc,
            upsert: true,
          },
        }))
      );
    }
    const flowPruneCutoff = turn - COMMODITY_FLOW_RETENTION_TURNS;
    if (flowPruneCutoff > 0) {
      await db.collection("commodityFlows").deleteMany({ turn: { $lt: flowPruneCutoff } });
    }
  }

  // Value the trade flows (computed before pricing, above) at the national
  // prices just produced, and persist the per-turn snapshot.
  const tradeSnapshot = valueTradeSnapshot(
    countries,
    tradeClearing,
    appliedNationalPrices,
    appliedGlobalPrices,
    turn,
    now
  );
  // Read path for the reachable books is "latest turn that has them", so the
  // descending-turn index is what keeps it O(1) as the snapshot history grows.
  // Fire-and-forget, mirroring commodityFlows/commoditySourcingFlows above.
  void db
    .collection("tradeFlowSnapshots")
    .createIndex({ turn: -1 })
    .catch(() => {});
  await db
    .collection("tradeFlowSnapshots")
    .updateOne(
      { turn },
      { $set: { ...tradeSnapshot, books: serializeReachableBooks(reachableBooks) } },
      { upsert: true }
    );

  return { tradeClearedVolume: tradeSnapshot.world.clearedVolume };
}
