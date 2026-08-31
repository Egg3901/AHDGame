/**
 * Start the bounded removal of Retail's legacy supply-derived demand.
 *
 * Dry run by default:
 *   npx tsx scripts/migrations/2026-08-31-start-retail-demand-unwind.ts --json
 *
 * Apply:
 *   npx tsx scripts/migrations/2026-08-31-start-retail-demand-unwind.ts --apply --json
 *
 * This migration writes only two gameConfig controls. It does not delete
 * plants, alter capacity, move cash, or rewrite prices.
 */
import "dotenv/config";
import { MongoClient } from "mongodb";
import type { GameConfig, GameState } from "../../src/lib/db/types";
import { resolveMongoDbName } from "../../src/lib/mongodb";
import {
  RETAIL_DEMAND_TRANSITION_DEFAULT_TURNS,
  retailLegacyDemandFactor,
} from "../../src/lib/market/retailDemandTransition";

const apply = process.argv.includes("--apply");
const json = process.argv.includes("--json");
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
    const [config, state] = await Promise.all([
      db.collection<GameConfig>("gameConfig").findOne({ _id: "default" }),
      db.collection<GameState>("gameState").findOne({ _id: "current" }),
    ]);
    if (config?.marketSystemMode !== "plants") {
      throw new Error(`Refusing Retail unwind while marketSystemMode=${config?.marketSystemMode}`);
    }
    if (config.householdConsumptionEnabled !== true) {
      throw new Error("Refusing Retail unwind while householdConsumptionEnabled is not true");
    }
    const currentTurn = state?.currentTurn;
    if (typeof currentTurn !== "number" || !Number.isFinite(currentTurn)) {
      throw new Error("Current game turn is unavailable");
    }

    const alreadyStarted =
      typeof config.retailDemandTransitionStartTurn === "number" &&
      Number.isFinite(config.retailDemandTransitionStartTurn);
    const startTurn = alreadyStarted ? config.retailDemandTransitionStartTurn! : currentTurn;
    const duration =
      typeof config.retailDemandTransitionTurns === "number" &&
      Number.isFinite(config.retailDemandTransitionTurns) &&
      config.retailDemandTransitionTurns > 0
        ? config.retailDemandTransitionTurns
        : RETAIL_DEMAND_TRANSITION_DEFAULT_TURNS;
    let modified = 0;
    if (apply && !alreadyStarted) {
      const result = await db.collection<GameConfig>("gameConfig").updateOne(
        { _id: "default", retailDemandTransitionStartTurn: { $exists: false } },
        {
          $set: {
            retailDemandTransitionStartTurn: startTurn,
            retailDemandTransitionTurns: duration,
          },
        }
      );
      modified = result.modifiedCount;
    }

    const report = {
      mode: apply ? "apply" : "dry-run",
      marketSystemMode: config.marketSystemMode,
      householdConsumptionEnabled: config.householdConsumptionEnabled,
      currentTurn,
      alreadyStarted,
      startTurn,
      durationTurns: duration,
      endTurn: startTurn + duration,
      currentLegacyDemandFactor: retailLegacyDemandFactor(
        {
          retailDemandTransitionStartTurn: startTurn,
          retailDemandTransitionTurns: duration,
        },
        currentTurn
      ),
      modified,
      fieldsTouched: ["retailDemandTransitionStartTurn", "retailDemandTransitionTurns"],
    };
    if (json) console.log(JSON.stringify(report, null, 2));
    else console.log(report);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
