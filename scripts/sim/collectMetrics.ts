/**
 * Reads balance metrics from a (sandbox) sim world and writes the report back
 * into the control-plane `simJobs` collection — the SAME production Mongo the
 * live game and the ops-dashboard's worldsim MCP already use (alongside the
 * existing `sim_scenarios` collection; this is orchestration metadata, never
 * game-engine state). Run as a separate step after scripts/sim/runWorld.ts so
 * a metrics-collection bug can never threaten an already-completed turn run.
 *
 * Two DBs, two separate connections, on purpose:
 *   - SIM_MONGODB_URI/SIM_DB_NAME (or --db) → sandbox world, read-only here.
 *     Uses the @/lib/mongodb getDb() singleton via the same env-var trick as
 *     runWorld.ts, so collectBalanceMetrics's queries match production code.
 *   - OPS_MONGODB_URI/OPS_DB_NAME → control-plane simJobs doc, write-only
 *     here. A raw MongoClient, deliberately NOT the @/lib/mongodb singleton
 *     (which is already pinned to the sandbox by the time this connects).
 *
 * Usage:
 *   SIM_MONGODB_URI=mongodb://127.0.0.1:27018 OPS_MONGODB_URI=mongodb://... \
 *     npx tsx scripts/sim/collectMetrics.ts --db=ahd_sim_run1 --run-id=run1
 */

// Forces module scope — otherwise this file (no top-level import/export,
// only dynamic imports inside main()) is treated as a global script, and its
// top-level const/function names collide with any other script under the
// same pattern (e.g. collectExperimentReport.ts).
export {};

function arg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.find((v) => v.startsWith(prefix));
  return found?.slice(prefix.length);
}

const SIM_MONGODB_URI = process.env.SIM_MONGODB_URI;
const dbName = arg("db");
const runId = arg("run-id");
const OPS_MONGODB_URI = process.env.OPS_MONGODB_URI;
const opsDbName = process.env.OPS_DB_NAME || "a-house-divided";

if (!SIM_MONGODB_URI || !dbName || !runId) {
  console.error(
    "Usage: SIM_MONGODB_URI=... OPS_MONGODB_URI=... npx tsx scripts/sim/collectMetrics.ts --db=<sandboxDbName> --run-id=<runId>"
  );
  process.exit(1);
}
if (!OPS_MONGODB_URI) {
  console.error("OPS_MONGODB_URI is required — the control-plane DB to write the report to.");
  process.exit(1);
}

(process.env as { NODE_ENV: string }).NODE_ENV = "test";
process.env.MONGODB_URI = SIM_MONGODB_URI;
process.env.MONGODB_DB = dbName;

async function main() {
  const { MongoClient } = await import("mongodb");
  const { getDb } = await import("@/lib/mongodb");
  const { collectBalanceMetrics } = await import("@/lib/sim/metrics");

  const sandboxDb = await getDb();
  console.log(`[metrics:${runId}] Collecting balance metrics from ${dbName}`);
  const report = await collectBalanceMetrics(sandboxDb);

  console.log(
    `[metrics:${runId}] turn=${report.turn} npps=${report.wealth.nppCount} ` +
      `wealthGini=${report.wealth.gini.toFixed(3)} top1%=${(report.wealth.top1PctShare * 100).toFixed(1)}% ` +
      `contested=${(report.electoral.contestedPct * 100).toFixed(1)}% effectiveParties=${report.electoral.effectivePartyCount.toFixed(2)} ` +
      `inflation=${report.economy.inflationIndex.toFixed(3)} crisesActive=${report.crises.active} ` +
      `capStock=${report.capacity.totalCapitalStock.toFixed(0)} meanUtil=${report.capacity.meanCapitalUtilization.toFixed(3)} ` +
      `produced=${report.capacity.totalProducedUnits.toFixed(0)} sold=${report.capacity.totalSoldUnits.toFixed(0)} ` +
      `plantsMigrated=${report.capacity.plantsMigratedSectors}/${report.capacity.sectorCount}`
  );

  const opsClient = new MongoClient(OPS_MONGODB_URI as string);
  try {
    await opsClient.connect();
    const simJobs = opsClient.db(opsDbName).collection("simJobs");
    await simJobs.updateOne(
      { _id: runId as never },
      { $set: { metrics: report, metricsCollectedAt: new Date(), updatedAt: new Date() } }
    );
    console.log(`[metrics:${runId}] Report written to control-plane simJobs.`);
  } finally {
    await opsClient.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`[metrics:${runId}] FAILED:`, error);
    process.exit(1);
  });
