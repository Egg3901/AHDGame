/**
 * Repair persisted inflation values for specific country/turn pairs when the
 * turn-time write path stored values that do not match the historical inputs.
 *
 * The current live issue is the US inflation drop on turns 555 and 556, so this
 * script defaults to `--country=US --turns=555,556`.
 *
 * The repair is intentionally narrow:
 * - Recomputes target turns sequentially from historical turn inputs
 * - Updates centralBanks.<country>.inflationHistory for those turns
 * - Updates the current federal budget inflation rate when the repaired turn is
 *   the latest inflation snapshot for that country
 * - Updates matching gameHealthSnapshots economy inflation values for the same turns
 *
 * Historical reconstruction sources:
 * - unemployment: stateMetricHistory national-scope snapshots for the target turn
 * - GDP growth: centralBank.gdpGrowthHistory snapshot for the target turn
 * - prime rate: centralBank.interestRateHistory snapshot for the target turn
 * - prime rate history / lag: interestRateHistory through targetTurn - 1
 * - commodity pressure: commodityPriceHistory national prices for the target turn
 * - forex pressure: exchangeRates.rateHistory settled value from targetTurn - 1
 * - savings pressure: centralBank.savingsFlowHistory snapshot for the target turn
 * - fiscal / tariff / wage inputs: current live policy state (acceptable here
 *   because the affected turns are recent and no fiscal-year boundary intervened)
 *
 * Usage:
 *   npx tsx scripts/migrations/heal-inflation-history-turns.ts
 *   npx tsx scripts/migrations/heal-inflation-history-turns.ts --apply
 *   npx tsx scripts/migrations/heal-inflation-history-turns.ts --country=US --turns=555,556
 *   npx tsx scripts/migrations/heal-inflation-history-turns.ts --db=local --apply
 */

import { MongoClient, ObjectId, type Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type {
  CentralBank,
  ExchangeRate,
  FederalBudget,
  GameHealthSnapshot,
} from "../../src/lib/db/types";
import type { CommodityPrice } from "../../src/lib/db/types/commodityPrice";
import type { CommodityPriceHistory } from "../../src/lib/db/types/commodityPriceHistory";
import type { MetricCategoryId } from "../../src/lib/db/types/stateMetrics";
import type { Tariff } from "../../src/lib/db/types/tariff";
import type { CountryId } from "../../src/lib/constants/countries";
import { COUNTRY_CONFIGS } from "../../src/lib/constants/countries";
import { getNationalDocId } from "../../src/lib/constants/nationalScope";
import type { Corporation, CorporateSector } from "../../src/lib/db/types";
import { computeCountryTariffPressure } from "../../src/lib/tariffs/tariffEffects";
import { buildFtaCoverageLookup, loadActiveFtaPairs } from "../../src/lib/tariffs/ftaOverrides";
import { calculateInflationWithBreakdown } from "../../src/lib/budget/inflation";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const DB_NAME = "a-house-divided";
const DEFAULT_COUNTRY: CountryId = "US";
const DEFAULT_TURNS = [555, 556];

type MetricHistoryEntry = { turn: number; value: number };
type MetricHistoryDoc = {
  _id: string;
  [key: string]: unknown;
};

interface RepairPoint {
  turn: number;
  storedRate: number | null;
  repairedRate: number;
  breakdown: ReturnType<typeof calculateInflationWithBreakdown>["breakdown"];
  inputs: {
    unemployment: number;
    gdpGrowth: number;
    primeRate: number;
    primeRateHistoryLength: number;
    surplusToGdp: number;
    tariffRate: number;
    wageGrowth: number;
    commodityPressure: number;
    forexPressure: number;
    savingsPressure: number;
    previousInflation: number;
  };
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseCountryArg(): CountryId {
  const raw = process.argv.find((arg) => arg.startsWith("--country="));
  return (raw?.slice("--country=".length) || DEFAULT_COUNTRY).toUpperCase() as CountryId;
}

function parseTurnsArg(): number[] {
  const raw = process.argv.find((arg) => arg.startsWith("--turns="));
  const parsed = (raw?.slice("--turns=".length) || DEFAULT_TURNS.join(","))
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((turn) => Number.isFinite(turn))
    .sort((a, b) => a - b);
  if (parsed.length === 0) {
    throw new Error("No valid turns supplied. Use --turns=555,556");
  }
  return parsed;
}

function resolveUri(): string {
  const local = process.argv.includes("--db=local");
  const uri = local ? process.env.MONGODB_URI : process.env.MONGODB_URI_LIVE;
  if (!uri) {
    throw new Error(
      local
        ? "MONGODB_URI is not set. Use --db=local only when that env var exists."
        : "MONGODB_URI_LIVE is not set."
    );
  }
  return uri;
}

function getMetricHistoryValue(
  doc: MetricHistoryDoc | null,
  category: MetricCategoryId,
  metricId: string,
  turn: number,
  fallback: number
): number {
  const categoryValue = doc?.[category];
  if (!categoryValue || typeof categoryValue !== "object") return fallback;
  const history = (categoryValue as Record<string, unknown>)[metricId];
  if (!Array.isArray(history)) return fallback;
  const point = (history as MetricHistoryEntry[]).find((entry) => entry.turn === turn);
  return finiteOr(point?.value, fallback);
}

function getSnapshotRate(
  history: Array<{ turn: number; rate: number }> | undefined,
  turn: number,
  fallback: number
): number {
  const point = history?.find((entry) => entry.turn === turn);
  return finiteOr(point?.rate, fallback);
}

function getSnapshotRateAtOrBefore(
  history: Array<{ turn: number; rate: number }> | undefined,
  turn: number,
  fallback: number
): number {
  const point = [...(history ?? [])]
    .filter((entry) => entry.turn <= turn)
    .sort((a, b) => b.turn - a.turn)[0];
  return finiteOr(point?.rate, fallback);
}

function computeCommodityPressureForTurn(
  countryId: CountryId,
  commodityDocs: CommodityPrice[],
  commodityHistoryDocs: CommodityPriceHistory[]
): number {
  const historyByCommodity = new Map(
    commodityHistoryDocs.map((doc) => [doc.commodity, doc.nationalPrices ?? {}] as const)
  );
  const pressures: number[] = [];
  for (const doc of commodityDocs) {
    const nationalPrice = historyByCommodity.get(doc.commodity)?.[countryId];
    if (
      typeof nationalPrice === "number" &&
      Number.isFinite(nationalPrice) &&
      typeof doc.basePrice === "number" &&
      doc.basePrice > 0
    ) {
      const raw = nationalPrice / doc.basePrice - 1.0;
      const clamped = Math.max(-0.9, Math.min(10.0, raw));
      pressures.push(clamped);
    }
  }
  return pressures.length > 0
    ? pressures.reduce((sum, value) => sum + value, 0) / pressures.length
    : 0;
}

async function warnIfTurnsActive(db: Db, apply: boolean): Promise<void> {
  const gameState = await db
    .collection<{
      _id: string;
      isActive?: boolean;
      isProcessing?: boolean;
      currentTurn?: number;
    }>("gameState")
    .findOne({ _id: "current" });
  if (!gameState) return;
  if (!gameState.isActive && !gameState.isProcessing) return;

  console.warn(
    `[heal-inflation-history-turns] WARNING: gameState.isActive=${gameState.isActive === true} isProcessing=${gameState.isProcessing === true} currentTurn=${gameState.currentTurn ?? "?"}`
  );
  if (!apply) return;
  console.warn("[heal-inflation-history-turns] Sleeping 10s before apply. Ctrl-C now to abort.");
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

async function buildRepairPlan(
  db: Db,
  countryId: CountryId,
  turns: number[]
): Promise<RepairPoint[]> {
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) throw new Error(`Unknown countryId ${countryId}`);

  const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: countryId });
  if (!bank) throw new Error(`Central bank ${countryId} not found`);

  const nationalDocId = getNationalDocId(countryId);
  if (!nationalDocId) throw new Error(`No national metrics doc id registered for ${countryId}`);

  const budgetId = config.governmentType === "presidential" ? "federal" : countryId;
  const [
    budget,
    nationalMetricHistory,
    tariffs,
    exchangeRateDoc,
    commodityDocs,
    sectors,
    activeFtaPairs,
  ] = await Promise.all([
    db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId } as { _id: "federal" }),
    db.collection<MetricHistoryDoc>("stateMetricHistory").findOne({ _id: nationalDocId }),
    db.collection<Tariff>("tariffs").find({ countryId }).toArray(),
    db.collection<ExchangeRate>("exchangeRates").findOne({ _id: countryId }),
    db
      .collection<CommodityPrice>("commodityPrices")
      .find({}, { projection: { commodity: 1, basePrice: 1 } })
      .toArray(),
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { countryId },
        { projection: { corporationId: 1, countryId: 1, sectorType: 1, revenue: 1 } }
      )
      .toArray(),
    loadActiveFtaPairs(db),
  ]);

  if (!budget) throw new Error(`Federal budget ${budgetId} not found for ${countryId}`);

  const corpObjectIds = [...new Set(sectors.map((sector) => sector.corporationId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const corporations =
    corpObjectIds.length > 0
      ? await db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: corpObjectIds } }, { projection: { countryId: 1 } })
          .toArray()
      : [];
  const corpById = new Map(corporations.map((corp) => [corp._id.toString(), corp]));

  const ftaCoverage = buildFtaCoverageLookup(sectors, corpById, activeFtaPairs);
  const tariffRate = computeCountryTariffPressure(
    tariffs,
    countryId,
    sectors,
    corpById,
    ftaCoverage
  );
  const wageGrowth = finiteOr(budget.economicFactors?.wageGrowth, 3.0);
  const gdp = finiteOr(budget.gdp, 27_000_000_000_000);
  const surplusToGdp = finiteOr(budget.surplus, 0) / gdp;

  const commodityHistoryDocs = await db
    .collection<CommodityPriceHistory>("commodityPriceHistory")
    .find({ turn: { $in: turns } }, { projection: { commodity: 1, turn: 1, nationalPrices: 1 } })
    .toArray();
  const commodityHistoryByTurn = new Map<number, CommodityPriceHistory[]>();
  for (const doc of commodityHistoryDocs) {
    const arr = commodityHistoryByTurn.get(doc.turn) ?? [];
    arr.push(doc);
    commodityHistoryByTurn.set(doc.turn, arr);
  }

  const storedInflationByTurn = new Map(
    (bank.inflationHistory ?? []).map((entry) => [entry.turn, entry.rate])
  );
  const repairedByTurn = new Map<number, number>();
  const points: RepairPoint[] = [];

  for (const turn of turns) {
    const unemployment = getMetricHistoryValue(
      nationalMetricHistory,
      "economic",
      "unemploymentRate",
      turn,
      5.0
    );
    const gdpGrowth = getSnapshotRate(bank.gdpGrowthHistory, turn, 2.5);
    const primeRate = getSnapshotRate(
      bank.interestRateHistory,
      turn,
      finiteOr(bank.primeRate, 3.0)
    );
    const primeRateHistory = (bank.interestRateHistory ?? [])
      .filter((entry) => entry.turn <= turn - 1)
      .map((entry) => entry.rate)
      .filter((rate) => Number.isFinite(rate));
    const commodityPressure = computeCommodityPressureForTurn(
      countryId,
      commodityDocs,
      commodityHistoryByTurn.get(turn) ?? []
    );
    const previousFxRate = getSnapshotRateAtOrBefore(
      exchangeRateDoc?.rateHistory,
      turn - 1,
      finiteOr(exchangeRateDoc?.baseRate, 1)
    );
    const baseFxRate = finiteOr(exchangeRateDoc?.baseRate, 1);
    const forexPressure = baseFxRate > 0 ? previousFxRate / baseFxRate - 1.0 : 0.0;
    const savingsPressure = getSnapshotRate(bank.savingsFlowHistory, turn, 0) / 100;
    const previousInflation =
      repairedByTurn.get(turn - 1) ??
      finiteOr(
        storedInflationByTurn.get(turn - 1),
        finiteOr(budget.economicFactors?.inflationRate, 2.5)
      );

    const { rate: repairedRate, breakdown } = calculateInflationWithBreakdown({
      unemployment,
      gdpGrowth,
      primeRate,
      primeRateHistory,
      surplusToGdp,
      tariffRate,
      wageGrowth,
      commodityPressure,
      forexPressure,
      savingsPressure,
      previousInflation,
    });

    repairedByTurn.set(turn, repairedRate);
    points.push({
      turn,
      storedRate:
        typeof storedInflationByTurn.get(turn) === "number"
          ? finiteOr(storedInflationByTurn.get(turn), 0)
          : null,
      repairedRate,
      breakdown,
      inputs: {
        unemployment,
        gdpGrowth,
        primeRate,
        primeRateHistoryLength: primeRateHistory.length,
        surplusToGdp,
        tariffRate,
        wageGrowth,
        commodityPressure,
        forexPressure,
        savingsPressure,
        previousInflation,
      },
    });
  }

  return points;
}

async function applyRepair(db: Db, countryId: CountryId, points: RepairPoint[]): Promise<void> {
  const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: countryId });
  if (!bank) throw new Error(`Central bank ${countryId} not found for apply`);

  const repairedMap = new Map(points.map((point) => [point.turn, point.repairedRate]));
  const nextInflationHistory = (bank.inflationHistory ?? []).map((entry) =>
    repairedMap.has(entry.turn) ? { ...entry, rate: repairedMap.get(entry.turn)! } : entry
  );

  await db.collection<CentralBank>("centralBanks").updateOne(
    { _id: countryId },
    {
      $set: {
        inflationHistory: nextInflationHistory,
        updatedAt: new Date(),
      },
    }
  );

  const latestRepairedTurn = Math.max(...points.map((point) => point.turn));
  const latestHistoryTurn = Math.max(...nextInflationHistory.map((entry) => entry.turn));
  if (latestRepairedTurn === latestHistoryTurn) {
    const config = COUNTRY_CONFIGS[countryId];
    const budgetId = config.governmentType === "presidential" ? "federal" : countryId;
    const latestRate = repairedMap.get(latestRepairedTurn)!;
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id: budgetId } as { _id: "federal" }, {
        $set: {
          "economicFactors.inflationRate": latestRate,
          "economicFactors.lastUpdated": new Date(),
          updatedAt: new Date(),
        },
      });
  }

  for (const point of points) {
    await db
      .collection<GameHealthSnapshot>("gameHealthSnapshots")
      .updateMany(
        { turn: point.turn },
        { $set: { [`economy.byCountry.${countryId}.inflation`]: point.repairedRate } }
      );
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const countryId = parseCountryArg();
  const turns = parseTurnsArg();
  const uri = resolveUri();

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
    await warnIfTurnsActive(db, apply);

    console.log(
      `[heal-inflation-history-turns] mode=${apply ? "APPLY" : "DRY-RUN"} country=${countryId} turns=${turns.join(",")}`
    );

    const points = await buildRepairPlan(db, countryId, turns);
    for (const point of points) {
      console.log(
        `turn ${point.turn}: stored=${point.storedRate?.toFixed(2) ?? "missing"} repaired=${point.repairedRate.toFixed(2)}`
      );
      console.log(
        `  inputs: unemployment=${point.inputs.unemployment.toFixed(2)} gdp=${point.inputs.gdpGrowth.toFixed(2)} prime=${point.inputs.primeRate.toFixed(2)} history=${point.inputs.primeRateHistoryLength} commodity=${point.inputs.commodityPressure.toFixed(4)} forex=${point.inputs.forexPressure.toFixed(4)} savings=${point.inputs.savingsPressure.toFixed(4)} prevInfl=${point.inputs.previousInflation.toFixed(2)}`
      );
      console.log(
        `  breakdown: base=${point.breakdown.base.toFixed(2)} unemployment=${point.breakdown.unemployment.toFixed(2)} gdp=${point.breakdown.gdp.toFixed(2)} monetary=${point.breakdown.monetary.toFixed(2)} fiscal=${point.breakdown.fiscal.toFixed(2)} tariff=${point.breakdown.tariff.toFixed(2)} wage=${point.breakdown.wage.toFixed(2)} commodity=${point.breakdown.commodity.toFixed(2)} forex=${point.breakdown.forex.toFixed(2)} savings=${point.breakdown.savings.toFixed(2)} inertia=${point.breakdown.inertia.toFixed(2)}`
      );
    }

    if (!apply) {
      console.log("[heal-inflation-history-turns] Dry-run complete. Re-run with --apply to write.");
      return;
    }

    await applyRepair(db, countryId, points);
    console.log("[heal-inflation-history-turns] Applied repair successfully.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("[heal-inflation-history-turns] failed:", error);
  process.exit(1);
});
