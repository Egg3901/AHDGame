/**
 * Clone the live game world into an isolated sim sandbox DB, for quick
 * clone-mode runs (see runWorld.ts --clone-mode). Copies STATE, not history:
 * the large append-only log/audit collections are excluded because the turn
 * engine never reads them and they dominate the data volume.
 *
 * Required env:
 *   SOURCE_MONGODB_URI  — the live game DB connection (read-only usage)
 *   SOURCE_DB_NAME      — live game db name
 *   SIM_MONGODB_URI     — sandbox MongoDB (the copy destination)
 *
 * Usage: npx tsx scripts/sim/cloneWorld.ts --db=ahd_sim_clone_foo [--drop]
 *
 * The destination name MUST start with "ahd_sim_" — the same convention the
 * sim worker enforces — so a mistyped flag can never bulldoze a real DB.
 */

import { MongoClient } from "mongodb";

const SOURCE_MONGODB_URI = process.env.SOURCE_MONGODB_URI;
const SOURCE_DB_NAME = process.env.SOURCE_DB_NAME || "a-house-divided";
const SIM_MONGODB_URI = process.env.SIM_MONGODB_URI;

/**
 * Append-only history, telemetry, audit and ops collections the engine never
 * reads during a turn. Everything NOT listed here is copied. When in doubt a
 * collection is copied: a stale extra collection is inert, a missing one can
 * break the engine mid-run.
 */
const EXCLUDED_COLLECTIONS = new Set([
  "actionAuditLog",
  "actionLogs",
  "activityLog",
  "adminLog",
  "adminLogs",
  "apiAbuseScans",
  "apiAccessLog",
  "bondHistory",
  "botApiRequestLog",
  "capitalActionLogs",
  "code_sessions",
  "corporationHistory",
  "corporationPortfolioHistory",
  "daily_reports",
  "discord_ideas",
  "discord_ingest_state",
  "discord_messages",
  "discord_themes",
  "financialTxLog",
  "fix_sessions",
  "healBackups",
  "healRuns",
  "indexFundSnapshots",
  "indexFundTransactions",
  "knowledge_query_log",
  "ledgerEntries",
  "ledgerReconciliations",
  "modAuditLog",
  "moneySupplySnapshots",
  "notifications",
  "ops_knowledge",
  "ops_qa_log",
  "orgRegLedger",
  "partyHistory",
  "partyPoliticalStrengthLedger",
  "playerMail",
  "portfolioHistory",
  "pr_reviews",
  "primarySnapshots",
  "qa_memory",
  "shareTradeHistory",
  "siteTrafficPageviews",
  "statePartyElections",
  "tradeHistory",
  "treasuryTransactions",
  "wealthListHistory",
  "wireEvents",
]);

const BATCH = 2000;

function arg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.find((v) => v.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main() {
  if (!SOURCE_MONGODB_URI) throw new Error("SOURCE_MONGODB_URI is required");
  if (!SIM_MONGODB_URI) throw new Error("SIM_MONGODB_URI is required");
  const destName = arg("db");
  if (!destName || !/^ahd_sim_[a-zA-Z0-9_-]+$/.test(destName)) {
    throw new Error("--db is required and must match ^ahd_sim_[a-zA-Z0-9_-]+$");
  }
  const drop = process.argv.includes("--drop");

  const src = new MongoClient(SOURCE_MONGODB_URI);
  const dst = new MongoClient(SIM_MONGODB_URI);
  await src.connect();
  await dst.connect();
  const sdb = src.db(SOURCE_DB_NAME);
  const ddb = dst.db(destName);

  if (drop) {
    await ddb.dropDatabase();
    console.log(`[clone] dropped ${destName}`);
  }

  const collections = (await sdb.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system.") && !EXCLUDED_COLLECTIONS.has(n))
    .sort();

  let totalDocs = 0;
  const started = Date.now();
  for (const name of collections) {
    const cursor = sdb.collection(name).find({}, { batchSize: BATCH });
    let batch: object[] = [];
    let copied = 0;
    for await (const doc of cursor) {
      batch.push(doc);
      if (batch.length >= BATCH) {
        await ddb.collection(name).insertMany(batch as never[], { ordered: false });
        copied += batch.length;
        batch = [];
      }
    }
    if (batch.length > 0) {
      await ddb.collection(name).insertMany(batch as never[], { ordered: false });
      copied += batch.length;
    }
    totalDocs += copied;
    if (copied > 0) console.log(`[clone] ${name}: ${copied}`);
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[clone] done: ${collections.length} collections, ${totalDocs} docs -> ${destName} in ${secs}s ` +
      `(${EXCLUDED_COLLECTIONS.size} history/log collections excluded)`
  );
  await src.close();
  await dst.close();
}

main().catch((err) => {
  console.error("[clone] FAILED:", err);
  process.exit(1);
});
