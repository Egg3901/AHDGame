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

import { SOVEREIGN_DEMAND_EXPERIMENT_FIELDS } from "./sovereignDemandExperimentFlags";
import {
  assertCollectorSourceMatch,
  attachActorCoverageSection,
  parseCollectorSourceArgs,
  resolveCollectorCommit,
} from "./collectorSource";

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
  const report = await collectExperimentsReport(sandboxDb, { runId });
  // #2083: a pinned job runs this collector from the validated pinned
  // worktree (worker passes --source-*). Prove it: the collector's own HEAD
  // must equal both the request and the SHA runWorld stamped, else exit
  // nonzero and write nothing.
  const { sourceCommit } = parseCollectorSourceArgs(process.argv);

  console.log(
    `[experiments:${runId}] turn=${report.turn} seatsPoints=${report.seatsTimeline.length} ` +
      `partyOrgPoints=${report.partyOrgTimeline.length} corpPoints=${report.corporationsTimeline.length}`
  );
  console.log(
    `[experiments:${runId}] longHorizon=${report.longHorizonTelemetry?.availability ?? "unavailable"} ` +
      `approvalPoints=${report.longHorizonTelemetry?.approval.points.length ?? 0} ` +
      `macroPoints=${report.longHorizonTelemetry?.macro.points.length ?? 0}`
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
    const simSource = (
      sandboxRun as {
        source?: {
          worktree?: string | null;
          requestedCommit?: string | null;
          executedPath?: string | null;
          executedCommit?: string | null;
        };
      } | null
    )?.source;
    const requestedCommit = sourceCommit ?? simSource?.requestedCommit ?? null;
    const collectorCommit = resolveCollectorCommit(process.cwd());
    assertCollectorSourceMatch({
      requestedCommit,
      simExecutedCommit: simSource?.executedCommit ?? null,
      collectorCommit,
    });
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
        // #2083: the collector's own SHA, proven equal to executedCommit
        // above. Pin-only: legacy unpinned reports keep their exact shape.
        ...(requestedCommit ? { collectorPath: process.cwd(), collectorCommit } : {}),
      },
      requestedConfig: job
        ? Object.fromEntries(
            Object.entries(job).filter(([key]) =>
              [
                "preset",
                "turns",
                "seed",
                "sourceWorktree",
                "sourceCommit",
                "startPolicy",
                "marketSystemMode",
                "labourSystemMode",
                "autonomyLevel",
                "actors",
                "allFeatureFlags",
                "freightSettlementMode",
                "canonicalFreightBillingEnabled",
                "shortageResponsiveSourcingEnabled",
                "indexFundBondLiquidityEnabled",
                ...SOVEREIGN_DEMAND_EXPERIMENT_FIELDS,
                "equityLiquidityFacilityEnabled",
                "nppMarketCoverageEnabled",
                "nppFragileMarketSupplyEnabled",
                "frontierEntryExperimentEnabled",
              ].includes(key)
            )
          )
        : undefined,
      effectiveConfigInitial: (
        sandboxRun as { effectiveConfigInitial?: Record<string, unknown> } | null
      )?.effectiveConfigInitial,
      mcpVersion,
      ...(await gitProvenance()),
    };

    // Actor coverage (#1993): the sandbox run doc carries the manifest
    // stamped by runWorld from live counts. Shared attach helper so the
    // branch-only section (#2040) survives collection exactly as the
    // regression test proves — including the prominent per-mechanic warnings,
    // so conclusions that touch a partial/unreachable system warn inline
    // instead of presenting vacancies as balance evidence.
    const actorManifest = (
      sandboxRun as {
        actorCoverage?: import("@/lib/sim/actorCoverage").ActorCoverageManifest;
      } | null
    )?.actorCoverage;
    attachActorCoverageSection(report as unknown as Record<string, unknown>, actorManifest);

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
