/**
 * Reads the election-balance report (per-election vote-over-time trajectories +
 * margin / dynamism roll-ups) from a (sandbox) elections-only sim world and
 * writes it into the control-plane `simElectionReports` collection — a SEPARATE
 * collection from `simJobs` (the frequently-polled status doc), same as
 * collectExperimentReport.ts writes simExperimentReports.
 *
 * Isolation pattern (identical to collectMetrics.ts / collectExperimentReport.ts):
 * SIM_MONGODB_URI (sandbox, read-only via the getDb() singleton env-override) +
 * OPS_MONGODB_URI (control-plane, write-only via a separate raw MongoClient).
 *
 * Usage:
 *   SIM_MONGODB_URI=mongodb://127.0.0.1:27018 OPS_MONGODB_URI=mongodb://... \
 *     npx tsx scripts/sim/collectElectionReport.ts --db=ahd_sim_run1 --run-id=run1
 */

// Forces module scope so top-level names don't collide with the other collector
// scripts (same reason collectExperimentReport.ts / runWorld.ts do this).
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
    "Usage: SIM_MONGODB_URI=... OPS_MONGODB_URI=... npx tsx scripts/sim/collectElectionReport.ts --db=<sandboxDbName> --run-id=<runId>"
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
  const { collectElectionReport } = await import("@/lib/sim/electionReport");

  const sandboxDb = await getDb();
  console.log(`[electionReport:${runId}] Collecting election report from ${dbName}`);
  const report = await collectElectionReport(sandboxDb);

  const resolved = report.totals.resolved;
  console.log(
    `[electionReport:${runId}] turn=${report.turn} elections=${report.totals.elections} ` +
      `withTally=${report.totals.withTally} resolved=${resolved} ` +
      `contestedPct=${(report.totals.contestedPct * 100).toFixed(0)}% ` +
      `medianMargin=${report.margin ? report.margin.median.toFixed(1) + "pt" : "n/a"} ` +
      `meanLeadChanges=${report.dynamism.meanLeadChanges.toFixed(2)}`
  );
  if (report.emptyCandidateSupplyCountries.length) {
    console.log(
      `[electionReport:${runId}] ⚠ no candidate supply: ${report.emptyCandidateSupplyCountries.join(", ")}`
    );
  }

  const opsClient = new MongoClient(OPS_MONGODB_URI as string);
  try {
    await opsClient.connect();
    const opsDb = opsClient.db(opsDbName);
    await opsDb
      .collection("simElectionReports")
      .updateOne({ _id: runId as never }, { $set: { runId, ...report } }, { upsert: true });
    console.log(`[electionReport:${runId}] Report written to simElectionReports.`);
  } finally {
    await opsClient.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`[electionReport:${runId}] FAILED:`, error);
    process.exit(1);
  });
