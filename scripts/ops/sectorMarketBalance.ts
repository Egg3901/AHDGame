/**
 * Read-only sector market health report.
 *
 * Reports current plant fill and output demand/supply coverage by sector type,
 * then flags imbalances that persisted across the last 24 turns. This is an
 * operator diagnostic only. It performs no writes.
 *
 * Usage:
 *   MONGODB_URI='mongodb://...' npx tsx scripts/ops/sectorMarketBalance.ts
 *   MONGODB_URI='mongodb://...' npx tsx scripts/ops/sectorMarketBalance.ts --json
 */
import "dotenv/config";
import { MongoClient } from "mongodb";
import type { CorporateSector, GameConfig, GameState } from "../../src/lib/db/types";
import type { CommodityPrice } from "../../src/lib/db/types/commodityPrice";
import type { CommodityPriceHistory } from "../../src/lib/db/types/commodityPriceHistory";
import type { CommodityType } from "../../src/lib/constants/commodities";
import { CORPORATION_TYPES, type CorporationType } from "../../src/lib/constants/corporations";
import { getStrategy } from "../../src/lib/constants/sectorStrategies";
import { foundingStarterUnits } from "../../src/lib/corporations/foundingPlant";
import {
  retailDemandTransitionTurnsRemaining,
  retailLegacyDemandFactor,
} from "../../src/lib/market/retailDemandTransition";
import { resolveMongoDbName } from "../../src/lib/mongodb";

const WINDOW_TURNS = 24;
const IMBALANCE_MIN_SAMPLES = 12;
const SURPLUS_RATIO = 0.5;
const SHORTAGE_RATIO = 2;

interface SectorBalanceRow {
  sectorType: CorporationType;
  plants: number;
  sectorRows: number;
  producedUnits: number;
  soldUnits: number;
  fillRate: number | null;
  outputDemandSupplyRatio: number | null;
  historySamples: number;
  persistentSurplus: boolean;
  persistentShortage: boolean;
  alerts: string[];
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function coverageRatio(supply: number, demand: number): number {
  if (supply <= 0) return demand > 0 ? Number.POSITIVE_INFINITY : 1;
  return demand / supply;
}

function outputCommodities(sectorType: CorporationType): CommodityType[] {
  return Object.keys(getStrategy(sectorType, "standard").supply ?? {}) as CommodityType[];
}

function sectorCoverage(
  sectorType: CorporationType,
  balanceFor: (commodity: CommodityType) => { supply: number; demand: number } | undefined
): number | null {
  const ratios = outputCommodities(sectorType)
    .map((commodity) => balanceFor(commodity))
    .filter((balance): balance is { supply: number; demand: number } => balance !== undefined)
    .map((balance) => coverageRatio(balance.supply, balance.demand));
  return ratios.length > 0 ? Math.min(...ratios) : null;
}

function fmt(value: number | null, digits = 2): string {
  if (value === null) return "n/a";
  if (!Number.isFinite(value)) return "inf";
  return value.toFixed(digits);
}

function readMongoUri(): string {
  const value = process.env.MONGODB_URI ?? process.env.MONGO_URL;
  if (!value) throw new Error("MONGODB_URI or MONGO_URL is required");
  return value;
}

async function main() {
  const client = new MongoClient(readMongoUri());
  await client.connect();
  try {
    const db = client.db(
      resolveMongoDbName({
        MONGODB_URI: process.env.MONGODB_URI,
        MONGO_URL: process.env.MONGO_URL,
        MONGODB_DB: process.env.MONGODB_DB,
        MONGO_DB_NAME: process.env.MONGO_DB_NAME,
      })
    );
    const [gameState, config, sectors, prices] = await Promise.all([
      db.collection<GameState>("gameState").findOne({ _id: "current" }),
      db.collection<GameConfig>("gameConfig").findOne({ _id: "default" }),
      db
        .collection<CorporateSector>("corporateSectors")
        .find(
          {},
          {
            projection: {
              sectorType: 1,
              capitalStock: 1,
              producedUnits: 1,
              soldUnits: 1,
              mothballed: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<CommodityPrice>("commodityPrices")
        .find({}, { projection: { commodity: 1, globalSupply: 1, globalDemand: 1 } })
        .toArray(),
    ]);
    const turn = finiteNonNegative(gameState?.currentTurn);
    const history = await db
      .collection<CommodityPriceHistory>("commodityPriceHistory")
      .find(
        { turn: { $gte: Math.max(0, turn - WINDOW_TURNS + 1), $lte: turn } },
        { projection: { commodity: 1, turn: 1, globalSupply: 1, globalDemand: 1 } }
      )
      .toArray();

    const currentByCommodity = new Map(
      prices.map((price) => [
        price.commodity,
        {
          supply: finiteNonNegative(price.globalSupply),
          demand: finiteNonNegative(price.globalDemand),
        },
      ])
    );
    const historyByTurn = new Map<number, Map<CommodityType, { supply: number; demand: number }>>();
    for (const point of history) {
      const byCommodity = historyByTurn.get(point.turn) ?? new Map();
      byCommodity.set(point.commodity, {
        supply: finiteNonNegative(point.globalSupply),
        demand: finiteNonNegative(point.globalDemand),
      });
      historyByTurn.set(point.turn, byCommodity);
    }

    const rows: SectorBalanceRow[] = CORPORATION_TYPES.map((sectorType) => {
      const owned = sectors.filter((sector) => sector.sectorType === sectorType);
      const active = owned.filter((sector) => sector.mothballed !== true);
      const producedUnits = active.reduce(
        (sum, sector) => sum + finiteNonNegative(sector.producedUnits),
        0
      );
      const soldUnits = active.reduce(
        (sum, sector) => sum + finiteNonNegative(sector.soldUnits),
        0
      );
      const fillRate = producedUnits > 0 ? soldUnits / producedUnits : null;
      const currentCoverage = sectorCoverage(sectorType, (commodity) =>
        currentByCommodity.get(commodity)
      );
      const historicalCoverage = [...historyByTurn.values()]
        .map((balances) => sectorCoverage(sectorType, (commodity) => balances.get(commodity)))
        .filter((ratio): ratio is number => ratio !== null);
      const enoughHistory = historicalCoverage.length >= IMBALANCE_MIN_SAMPLES;
      const persistentSurplus =
        enoughHistory && historicalCoverage.every((ratio) => ratio < SURPLUS_RATIO);
      const persistentShortage =
        enoughHistory && historicalCoverage.every((ratio) => ratio > SHORTAGE_RATIO);
      const alerts: string[] = [];
      if (persistentSurplus) alerts.push("persistent output surplus");
      if (persistentShortage) alerts.push("persistent output shortage");
      if (fillRate !== null && fillRate < 0.25) alerts.push("fill below 25%");

      return {
        sectorType,
        plants: owned.reduce(
          (sum, sector) =>
            sum + finiteNonNegative(sector.capitalStock) / foundingStarterUnits(sectorType),
          0
        ),
        sectorRows: owned.length,
        producedUnits,
        soldUnits,
        fillRate,
        outputDemandSupplyRatio: currentCoverage,
        historySamples: historicalCoverage.length,
        persistentSurplus,
        persistentShortage,
        alerts,
      };
    }).sort((a, b) => b.plants - a.plants);

    const retailTransitionStarted =
      typeof config?.retailDemandTransitionStartTurn === "number" &&
      Number.isFinite(config.retailDemandTransitionStartTurn);

    const report = {
      turn,
      marketSystemMode: config?.marketSystemMode ?? null,
      windowTurns: WINDOW_TURNS,
      thresholds: {
        persistentSampleMinimum: IMBALANCE_MIN_SAMPLES,
        surplusDemandSupplyRatioBelow: SURPLUS_RATIO,
        shortageDemandSupplyRatioAbove: SHORTAGE_RATIO,
        lowFillBelow: 0.25,
      },
      retailTransition: {
        started: retailTransitionStarted,
        legacyDemandFactor: retailLegacyDemandFactor(config, turn),
        turnsRemaining: retailTransitionStarted
          ? retailDemandTransitionTurnsRemaining(config, turn)
          : null,
      },
      alertCount: rows.reduce((sum, row) => sum + row.alerts.length, 0),
      sectors: rows,
    };

    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`Sector market balance at turn ${turn}`);
    const retailStatus = report.retailTransition.started
      ? `${report.retailTransition.turnsRemaining} turns remaining`
      : "transition not started";
    console.log(
      `Retail legacy demand factor ${fmt(report.retailTransition.legacyDemandFactor, 3)}, ${retailStatus}`
    );
    console.table(
      rows.map((row) => ({
        sector: row.sectorType,
        plants: Math.round(row.plants),
        fill: row.fillRate === null ? "n/a" : `${fmt(row.fillRate * 100, 1)}%`,
        "D/S": fmt(row.outputDemandSupplyRatio),
        history: row.historySamples,
        alerts: row.alerts.join(", ") || "ok",
      }))
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
