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

// Static import of a pure args module only (no Mongo, no env, no side
// effects): the requestedConfig projection is shared with simJobArgs.ts so a
// queueable field cannot be emitted by the worker yet dropped from the
// report. Everything else stays dynamically imported inside main() to avoid
// colliding with collectMetrics.ts's identical top-level names (same issue
// hit earlier with runWorld.ts).
import { normalizeSimJobRequestedConfig } from "./simJobArgs";

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
    const job = await opsDb.collection("simJobs").findOne({ _id: runId as never });
    const sandboxRun = await sandboxDb.collection("simRuns").findOne({ _id: runId as never });
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
      // Pinned source (#1966): provenance reachable only here, beside the
      // requested-vs-effective config identity below.
      source: {
        worktree: ((job as { sourceWorktree?: string } | null)?.sourceWorktree ??
          (sandboxRun as { source?: { worktree?: string } } | null)?.source?.worktree ??
          null) as string | null,
        requestedCommit: ((job as { sourceCommit?: string } | null)?.sourceCommit ??
          (sandboxRun as { source?: { requestedCommit?: string } } | null)?.source
            ?.requestedCommit ??
          null) as string | null,
        executedPath: ((sandboxRun as { source?: { executedPath?: string } } | null)?.source
          ?.executedPath ?? null) as string | null,
        executedCommit: ((sandboxRun as { source?: { executedCommit?: string } } | null)?.source
          ?.executedCommit ?? null) as string | null,
      },
      // Paired baseline (issue #1470 experiment-validity audit): what the
      // queue asked for (job doc) beside what the run executed against
      // (sandbox simRuns stamp). Both must agree; the pinned-pair assert
      // compares baseline identity through requestedConfig.
      pair: {
        pairId: ((job as { pairId?: string } | null)?.pairId ??
          (sandboxRun as { pairId?: string } | null)?.pairId ??
          null) as string | null,
        baselineId: ((job as { baselineId?: string } | null)?.baselineId ??
          (sandboxRun as { baselineId?: string } | null)?.baselineId ??
          null) as string | null,
      },
      // Run identity: what the queue asked for (authoritative projection
      // with run-profile normalization in simJobArgs.ts, so newly queueable
      // fields appear here automatically and countries spellings that run
      // identically report identically), beside effectiveConfigInitial for
      // what the sandbox run actually saw.
      requestedConfig: job
        ? normalizeSimJobRequestedConfig(job as Record<string, unknown>)
        : undefined,
      effectiveConfigInitial: (
        sandboxRun as { effectiveConfigInitial?: Record<string, unknown> } | null
      )?.effectiveConfigInitial,
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
