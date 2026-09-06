/**
 * Run the index-fund cron alone at a forced turn, with call-site tracing, so
 * the rebalance-day passes (every 24 turns) can be profiled without waiting
 * for one. Local databases only; mutates fund state like a real turn would.
 *
 *   TRACE_TURN=72 npx tsx scripts/perf/fund-cron-trace.ts
 */
import { Collection } from "mongodb";
const WATCH = new Set(
  (
    process.env.TRACE_COLLECTIONS ??
    "indexFunds,bonds,corporations,shareOrders,indexFundPositions,indexFundTransactions,characters,npps,imperialCharacters,exchangeRates,gameConfig,equityMarketPools,bondMarketPools"
  ).split(",")
);
const counts = new Map<string, number>();
function site(): string {
  const stack = (new Error().stack ?? "").split("\n").slice(2);
  const frames = stack
    .filter((l) => l.includes("/src/") && !l.includes("node_modules"))
    .slice(0, 3);
  return (
    frames
      .map((f) =>
        f
          .trim()
          .replace(/^at /, "")
          .replace(/.*\/worktrees\/[^/]+\//, "")
      )
      .join(" <- ") || "(no app frame)"
  );
}
for (const method of [
  "find",
  "findOne",
  "aggregate",
  "updateOne",
  "updateMany",
  "countDocuments",
  "bulkWrite",
  "insertOne",
  "insertMany",
  "findOneAndUpdate",
] as const) {
  const orig = (Collection.prototype as any)[method];
  (Collection.prototype as any)[method] = function (this: Collection, ...args: unknown[]) {
    if (WATCH.has(this.collectionName)) {
      const key = `${this.collectionName}.${method} @ ${site()}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return orig.apply(this, args);
  };
}

async function main() {
  const { connectDb, closeDb } = await import("../utils/db");
  const uri = process.env.MONGODB_URI ?? "";
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(uri)) {
    throw new Error(`Refusing to run against a non-local database (${uri || "unset"}).`);
  }
  const db = await connectDb();
  const { runIndexFundCron } = await import("../../src/lib/indexFunds/fundCron");
  const turn = Number(process.env.TRACE_TURN ?? 72);
  const t0 = Date.now();
  const result = await runIndexFundCron(db, { currentTurn: turn });
  console.log(`fund cron at turn ${turn}: ${Date.now() - t0}ms`, JSON.stringify(result));
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(`\n[callsites] ${total} watched calls; top call sites:`);
  for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    console.log(String(v).padStart(7), k);
  }
  await closeDb();
}
void main();
