/**
 * Catch the nominal commodity price level up using the retained global inflation
 * history. Dry-run by default; pass --apply after the deploying revision is live.
 */
import "dotenv/config";
import { getDb } from "../../src/lib/mongodb";
import type { CentralBank, GameConfig, GameState } from "../../src/lib/db/types";
import type { CommodityPrice } from "../../src/lib/db/types/commodityPrice";
import { compoundGlobalInflationHistory } from "../../src/lib/market/commodityNominalIndex";

const apply = process.argv.includes("--apply");
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const scaleMap = (values: Record<string, number> | undefined, factor: number) =>
  values == null
    ? undefined
    : Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, roundMoney(value * factor)])
      );

async function main() {
  const db = await getDb();
  const [state, config, banks, prices] = await Promise.all([
    db.collection<GameState>("gameState").findOne({ _id: "current" }),
    db.collection<GameConfig>("gameConfig").findOne({ _id: "default" }),
    db
      .collection<CentralBank>("centralBanks")
      .find({}, { projection: { inflationHistory: 1 } })
      .toArray(),
    db.collection<CommodityPrice>("commodityPrices").find({}).toArray(),
  ]);
  if (!state) throw new Error("Missing current game state");
  if ((config?.commodityNominalPriceIndex ?? 1) !== 1) {
    throw new Error("Commodity nominal index is already initialized; refusing to compound twice");
  }

  const ratesByTurn = new Map<number, number[]>();
  for (const bank of banks) {
    for (const point of bank.inflationHistory ?? []) {
      if (!Number.isFinite(point.turn) || !Number.isFinite(point.rate)) continue;
      const rates = ratesByTurn.get(point.turn) ?? [];
      rates.push(point.rate);
      ratesByTurn.set(point.turn, rates);
    }
  }
  const factor = compoundGlobalInflationHistory(ratesByTurn);
  const report = {
    apply,
    currentTurn: state.currentTurn,
    retainedTurns: ratesByTurn.size,
    factor,
    commodities: prices.length,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!apply) return;

  const now = new Date();
  const operations = prices.map((price) => ({
    updateOne: {
      filter: { commodity: price.commodity },
      update: {
        $set: {
          // A global hard peg is an explicit nominal price and remains untouched.
          ...(price.hardPeg == null ? { globalPrice: roundMoney(price.globalPrice * factor) } : {}),
          ...(price.hardPeg == null
            ? { nationalPrices: scaleMap(price.nationalPrices, factor) }
            : {}),
          ...(price.hardPeg == null
            ? { reachablePrices: scaleMap(price.reachablePrices, factor) }
            : {}),
          statePrices: Object.fromEntries(
            Object.entries(price.statePrices).map(([stateId, value]) => [
              stateId,
              price.stateHardPegs?.[stateId] == null ? roundMoney(value * factor) : value,
            ])
          ),
          updatedAt: now,
        },
      },
    },
  }));
  if (operations.length > 0) await db.collection("commodityPrices").bulkWrite(operations);
  await db.collection<GameConfig>("gameConfig").updateOne(
    { _id: "default" },
    {
      $set: {
        commodityNominalPriceIndex: factor,
        commodityNominalPriceIndexTurn: state.currentTurn,
      },
    }
  );
  console.log("Applied commodity inflation catch-up");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
