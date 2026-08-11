/**
 * Reads the full experiments report (seat/party-org/corporation timelines +
 * end-state balance metrics) from a (sandbox) sim world and writes it into
 * the control-plane `simExperimentReports` collection — a SEPARATE
 * collection from `simJobs` (not embedded there) since a full-run timeline
 * can be large across many turns/countries, and simJobs is the
 * frequently-polled status doc (sim_run_status) that shouldn't bloat.
 *
 * Same isolation pattern as collectMetrics.ts: SIM_MONGODB_URI (sandbox,
 * read-only, via the getDb() singleton env-override) + OPS_MONGODB_URI
 * (control-plane, write-only, separate raw MongoClient).
 *
 * Usage:
 *   SIM_MONGODB_URI=mongodb://127.0.0.1:27018 OPS_MONGODB_URI=mongodb://... \
 *     npx tsx scripts/sim/collectExperimentReport.ts --db=ahd_sim_run1 --run-id=run1
 */

// Forces module scope — otherwise this file (no top-level import/export,
// only dynamic imports inside main()) is treated as a global script, and its
// top-level const/function names collide with collectMetrics.ts's identical
// ones (same issue hit earlier this session with runWorld.ts).
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
    "Usage: SIM_MONGODB_URI=... OPS_MONGODB_URI=... npx tsx scripts/sim/collectExperimentReport.ts --db=<sandboxDbName> --run-id=<runId>"
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

/** Short git commit + dirty flag of the game repo the run executed against.
 *  Best-effort — never fails the report if git is unavailable. */
async function gitProvenance(): Promise<{ gitCommit?: string; gitDirty?: boolean }> {
  try {
    const { execSync } = await import("child_process");
    const gitCommit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const gitDirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
    return { gitCommit, gitDirty };
  } catch {
    return {};
  }
}

async function main() {
  const { MongoClient } = await import("mongodb");
  const { getDb } = await import("@/lib/mongodb");
  const { collectExperimentsReport } = await import("@/lib/sim/experimentsReport");

  const sandboxDb = await getDb();
  console.log(`[experiments:${runId}] Collecting experiments report from ${dbName}`);
  const report = await collectExperimentsReport(sandboxDb);

  console.log(
    `[experiments:${runId}] turn=${report.turn} seatsPoints=${report.seatsTimeline.length} ` +
      `partyOrgPoints=${report.partyOrgTimeline.length} corpPoints=${report.corporationsTimeline.length}`
  );

  const opsClient = new MongoClient(OPS_MONGODB_URI as string);
  try {
    await opsClient.connect();
    const opsDb = opsClient.db(opsDbName);

    // Enrich runConfig with provenance only reachable here: the control-plane
    // job doc (seed/turns) and the repo's git state. The worldsim MCP ships as
    // part of the ops-dashboard, so its version is that package's version.
    const job = await opsDb
      .collection("simJobs")
      .findOne({ _id: runId as never }, { projection: { seed: 1, turns: 1 } });
    let mcpVersion: string | undefined;
    try {
      const { readFileSync } = await import("fs");
      mcpVersion = JSON.parse(readFileSync("../ahd-ops-dashboard/package.json", "utf8")).version;
    } catch {
      /* MCP version optional */
    }
    report.runConfig = {
      ...report.runConfig,
      seed: (job as { seed?: string } | null)?.seed,
      turns: (job as { turns?: number } | null)?.turns,
      jobId: runId,
      mcpVersion,
      ...(await gitProvenance()),
    };

    await opsDb
      .collection("simExperimentReports")
      .updateOne(
        { _id: runId as never },
        { $set: { runId, ...report, collectedAt: new Date() } },
        { upsert: true }
      );
    console.log(
      `[experiments:${runId}] Report written (v${report.runConfig.appVersion}, seed=${report.runConfig.seed ?? "?"}, git=${report.runConfig.gitCommit ?? "?"}${report.runConfig.gitDirty ? "-dirty" : ""}).`
    );
  } finally {
    await opsClient.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`[experiments:${runId}] FAILED:`, error);
    process.exit(1);
  });
