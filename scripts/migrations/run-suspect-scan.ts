/**
 * One-shot suspect scan against current production data. Wraps
 * `runFinancialSuspectScan` so admins can re-run all the Phase 6 detectors
 * (time_velocity, same_price_wash, cash_mismatch + the legacy velocity /
 * round_trip / wash_trade) over an explicit turn window without waiting for
 * the next scheduled cron.
 *
 * Idempotent — `addFlag()` inside the scan dedupes by flag type per row, so
 * re-runs skip already-flagged rows of each type.
 *
 * Run:
 *   MONGODB_URI=... npx tsx scripts/migrations/run-suspect-scan.ts [--turn N]
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import path from "path";
import { runFinancialSuspectScan } from "../../src/lib/financialTxLog/suspectScan";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_LIVE;
  if (!uri) {
    console.error("MONGODB_URI (or MONGODB_URI_LIVE) not set");
    process.exit(1);
  }

  const turnArg = process.argv.indexOf("--turn");
  const explicitTurn =
    turnArg >= 0 && process.argv[turnArg + 1] ? parseInt(process.argv[turnArg + 1], 10) : null;

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  // Resolve the current turn from gameState unless overridden.
  const gs = await db.collection("gameState").findOne({ _id: "current" } as never);
  const turn = explicitTurn ?? (gs as { currentTurn?: number } | null)?.currentTurn ?? 0;

  console.log(`Running suspect scan against turn ${turn}…`);
  const before = await db.collection("financialTxLog").countDocuments({ flagged: true });
  await runFinancialSuspectScan(db, turn);
  const after = await db.collection("financialTxLog").countDocuments({ flagged: true });

  console.log(`Done. Flagged rows: ${before} → ${after} (Δ ${after - before}).`);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
