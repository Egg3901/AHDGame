/**
 * Sim job-queue worker. Polls the control-plane `simJobs` collection (the SAME
 * production Mongo the live game and the ops-dashboard's worldsim MCP use —
 * orchestration metadata only, alongside the existing `sim_scenarios`
 * collection) for queued runs, and drives each one through two child
 * processes: scripts/sim/runWorld.ts (turn engine) then
 * scripts/sim/collectMetrics.ts (balance report), both against an isolated
 * sandbox MongoDB — never the control-plane DB and never production game data.
 *
 * Deliberately NOT using @/lib/mongodb's getDb() singleton for the
 * control-plane connection: that singleton gets permanently pinned to
 * whichever DB the first import resolves, and each job needs the *child*
 * processes (not this one) pinned to a *different* (sandbox) DB per run. A
 * raw MongoClient here keeps this process's own DB connection independent of
 * whatever the children do in their own processes.
 *
 * Single job at a time, on purpose — this runs on the same shared box as the
 * live game; one sim job's turn processing is already CPU-heavy.
 *
 * Required env:
 *   OPS_MONGODB_URI   — control-plane DB (simJobs collection)
 *   SIM_MONGODB_URI   — sandbox MongoDB for actual world simulation
 *   GAME_REPO_DIR     — absolute path to the a-house-divided checkout to run
 *                        scripts/sim/{runWorld,collectMetrics}.ts from
 *
 * Usage: npx tsx scripts/sim/worker.ts
 */

import { spawn } from "child_process";
import { dirname, join } from "path";
import { MongoClient, type Db, type Collection } from "mongodb";
// Canonical tier list — a local literal here silently omitted every tier added
// after it was written (it stopped at "capital", so a "plants" job was rejected
// as invalid). Pure constant module: no Mongo, no env, safe to import eagerly.
import { MARKET_MODE_ORDER, type MarketSystemMode } from "@/lib/market/modes";
import { LABOUR_MODE_ORDER, type LabourSystemMode } from "@/lib/labour/modes";

const OPS_MONGODB_URI = process.env.OPS_MONGODB_URI;
const OPS_DB_NAME = process.env.OPS_DB_NAME || "a-house-divided";
const SIM_MONGODB_URI = process.env.SIM_MONGODB_URI;
const GAME_REPO_DIR = process.env.GAME_REPO_DIR || process.cwd();
const TICK_MS = Number(process.env.SIM_WORKER_TICK_MS || "15000");
// The LIVE game DB — required only for cloneFromLive jobs. NOT the same thing
// as OPS_MONGODB_URI: on the ops box the control-plane (simJobs) lives on the
// local Mongo while the live game lives on the hosted prod cluster. Cloning
// from the control-plane URI silently copies sim metadata and bootstraps a
// fresh world, which defeats the entire point of a clone run.
const LIVE_MONGODB_URI = process.env.LIVE_MONGODB_URI;
const LIVE_DB_NAME = process.env.LIVE_DB_NAME || "a-house-divided";
const STATUS_MIRROR_MS = Number(process.env.SIM_WORKER_STATUS_MIRROR_MS || "20000");

if (!OPS_MONGODB_URI) {
  console.error("OPS_MONGODB_URI is required (control-plane DB for the simJobs queue).");
  process.exit(1);
}
if (!SIM_MONGODB_URI) {
  console.error("SIM_MONGODB_URI is required (sandbox MongoDB for sim runs — never production).");
  process.exit(1);
}
// The control-plane credential is full-access (same one worldsim-server.js already
// uses for sim_scenarios) — this process's OWN code is what keeps it scoped to the
// simJobs collection (see getSimJobsCollection below). This check catches the one
// catastrophic misconfiguration that would defeat the sandbox/prod split entirely:
// pointing both URIs at the same database.
//
// On the ops box those are genuinely different servers (control-plane vs. the
// isolated sandbox mongod), and there the check must stay absolute. A LOCAL
// setup is the one legitimate exception: a laptop runs a single mongod that
// hosts both the sim_control db and the ahd_sim_* sandbox dbs, and there is no
// production anywhere near it. That case is opt-in and explicit — a shared URI
// is never inferred from the URI looking local, because "it looked like
// localhost" is exactly the reasoning that produces an accident once someone
// port-forwards production to 127.0.0.1.
//
// Note this only ever relaxes the URI comparison. The collision that actually
// matters — a job whose sandbox db IS the control-plane db — is still refused
// unconditionally in processJob() below.
const ALLOW_SHARED_MONGO = process.env.SIM_ALLOW_SHARED_MONGO === "1";
if (OPS_MONGODB_URI === SIM_MONGODB_URI && !ALLOW_SHARED_MONGO) {
  console.error(
    "OPS_MONGODB_URI and SIM_MONGODB_URI must not be the same — refusing to start.\n" +
      "If this is a LOCAL single-mongod setup (no production reachable), set " +
      "SIM_ALLOW_SHARED_MONGO=1 to allow it. Never set that on the ops box."
  );
  process.exit(1);
}

/** Pattern every job-derived value (id/seed/preset/dbName) must match before it's used
 * as a Mongo db name or passed as a child-process CLI arg — both have their own
 * restricted character sets (Mongo db names reject /\. "$*<>:|?), and this keeps
 * job documents from ever injecting something unexpected into either. */
const SAFE_TOKEN = /^[a-zA-Z0-9_-]{1,64}$/;

function assertSafeToken(value: string, field: string): string {
  if (!SAFE_TOKEN.test(value)) {
    throw new Error(
      `Job field "${field}" failed validation (got ${JSON.stringify(value)}): must match ${SAFE_TOKEN}`
    );
  }
  return value;
}

interface SimJob {
  _id: string;
  status: "queued" | "running" | "completed" | "failed";
  preset: string;
  turns: number;
  seed: string;
  dbName: string;
  marketSystemMode?: string;
  labourSystemMode?: string;
  freightSettlementMode?: "shadow" | "active";
  canonicalFreightBillingEnabled?: boolean;
  shortageResponsiveSourcingEnabled?: boolean;
  indexFundBondLiquidityEnabled?: boolean;
  nppMarketCoverageEnabled?: boolean;
  nppFragileMarketSupplyEnabled?: boolean;
  autonomyLevel?: string;
  /** Sim turn-phase profile: "elections-only" skips the economy phases. Default full. */
  mode?: "full" | "elections-only";
  /** Elections-only country scope: comma-separated ids (e.g. "US,UK,DE"). Omit for global. */
  countries?: string;
  /** Clone the LIVE world into the sandbox db first, then run --clone-mode.
   * Quick before/after validation of deployed code on real state. */
  cloneFromLive?: boolean;
  createdAt: Date;
  updatedAt: Date;
  workerStartedAt?: Date;
  currentTurn?: number;
  error?: string | null;
}

function log(msg: string) {
  console.log(`[sim-worker] ${msg}`);
}

/** The ONLY function in this file allowed to touch the control-plane DB's
 * collection set. Every other function takes a Collection<SimJob>, not a Db
 * or MongoClient, so there is exactly one place that could ever be edited to
 * reach a collection other than simJobs. */
function getSimJobsCollection(db: Db): Collection<SimJob> {
  return db.collection<SimJob>("simJobs");
}

/** Everything from this process's own env EXCEPT the control-plane credential —
 * a blocklist rather than a from-scratch allowlist, so npx/tsx still resolves
 * normally (PATH, NODE_*, TMPDIR, etc. all still flow through), but no child
 * spawned by this worker ever inherits OPS_MONGODB_URI unless it's explicitly
 * added back in (only collectMetrics.ts's env does that). */
function baseChildEnv(): NodeJS.ProcessEnv {
  const { OPS_MONGODB_URI: _drop, ...rest } = process.env;
  return rest;
}

// child_process.spawn (no shell) resolves the executable via the OS, which
// depends on PATH actually containing it — under systemd that's not
// guaranteed even when the unit's own ExecStart used an absolute path (that
// only resolves systemd's invocation, not this process's own PATH for
// spawning further children). node and npx ship in the same bin directory,
// so derive npx's path from this process's own executable rather than
// trusting PATH.
const NPX_PATH = join(dirname(process.execPath), "npx");

function run(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(NPX_PATH, ["tsx", script, ...args], {
      cwd: GAME_REPO_DIR,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code }));
  });
}

async function mirrorSandboxStatus(jobsCol: Collection<SimJob>, job: SimJob) {
  const client = new MongoClient(SIM_MONGODB_URI as string);
  try {
    await client.connect();
    const doc = await client
      .db(job.dbName)
      .collection("simRuns")
      .findOne({ _id: job._id as never });
    if (doc) {
      await jobsCol.updateOne(
        { _id: job._id },
        {
          $set: {
            currentTurn: doc.currentTurn,
            lastMessage: doc.lastMessage,
            lastWarnings: doc.lastWarnings,
            updatedAt: new Date(),
          },
        }
      );
    }
  } catch (err) {
    // Best-effort — a missed status mirror tick is not worth failing the job over.
    log(`status mirror failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client.close();
  }
}

async function processJob(jobsCol: Collection<SimJob>, job: SimJob) {
  // Validate before this job's fields touch a Mongo db name or a child-process
  // argv — see SAFE_TOKEN above. A job document only ever comes from this
  // worker's own findOneAndUpdate claim (tick()) or the worldsim MCP's
  // sim_run_world insert, but defense in depth costs nothing here.
  assertSafeToken(job._id, "_id");
  assertSafeToken(job.seed, "seed");
  assertSafeToken(job.preset, "preset");
  assertSafeToken(job.dbName, "dbName");
  if (job.dbName === OPS_DB_NAME) {
    throw new Error(
      `Job dbName "${job.dbName}" collides with the control-plane OPS_DB_NAME — refusing to run.`
    );
  }
  if (!Number.isInteger(job.turns) || job.turns <= 0 || job.turns > 5000) {
    throw new Error(`Job turns must be a positive integer <= 5000, got ${job.turns}`);
  }

  log(`Claimed job ${job._id} (preset=${job.preset}, turns=${job.turns}, db=${job.dbName})`);

  const statusMirror = setInterval(() => {
    mirrorSandboxStatus(jobsCol, job).catch(() => {});
  }, STATUS_MIRROR_MS);

  try {
    // Explicit allowlist, not a spread of process.env — runWorld.ts only ever
    // needs PATH-type basics plus this one var; it has no business seeing
    // OPS_MONGODB_URI (it never should, but it especially shouldn't be handed
    // the production credential it has no use for).
    const runWorldEnv = { ...baseChildEnv(), SIM_MONGODB_URI: SIM_MONGODB_URI as string };
    if (job.cloneFromLive) {
      // Copy the live world's STATE into the sandbox db (history/log
      // collections excluded — see cloneWorld.ts). The clone step is the one
      // child that legitimately needs the live-DB credential, read-only by
      // usage; it gets it explicitly and nothing else does.
      await jobsCol.updateOne(
        { _id: job._id },
        { $set: { status: "running", currentTurn: 0, updatedAt: new Date() } }
      );
      log(`Cloning live world ${LIVE_DB_NAME} -> ${job.dbName} ...`);
      if (!LIVE_MONGODB_URI) {
        throw new Error(
          "cloneFromLive job but LIVE_MONGODB_URI is not set — refusing to clone from the control-plane DB"
        );
      }
      const cloneEnv = {
        ...baseChildEnv(),
        SOURCE_MONGODB_URI: LIVE_MONGODB_URI,
        SOURCE_DB_NAME: LIVE_DB_NAME,
        SIM_MONGODB_URI: SIM_MONGODB_URI as string,
      };
      const cloneResult = await run(
        "scripts/sim/cloneWorld.ts",
        [`--db=${job.dbName}`, "--drop"],
        cloneEnv
      );
      if (cloneResult.code !== 0) {
        throw new Error(`cloneWorld exited with code ${cloneResult.code}`);
      }
      log(`Clone complete; running ${job.turns} turn(s) in clone mode`);
    }
    const runWorldArgs = [
      `--seed=${job.seed}`,
      `--preset=${job.preset}`,
      `--turns=${job.turns}`,
      `--db=${job.dbName}`,
      `--run-id=${job._id}`,
      ...(job.cloneFromLive ? ["--clone-mode"] : []),
    ];
    // Structural-market rollout tier (enum, not a free token) — passed through
    // to runWorld.ts, which patches the sandbox gameConfig after bootstrap.
    if (job.marketSystemMode) {
      if (!MARKET_MODE_ORDER.includes(job.marketSystemMode as MarketSystemMode)) {
        throw new Error(`invalid marketSystemMode "${job.marketSystemMode}"`);
      }
      runWorldArgs.push(`--market-mode=${job.marketSystemMode}`);
    }
    // Labour rollout tier, same treatment. Both tiers were raised together when
    // fresh worlds took the production posture, but only the market half could
    // be driven from here, so an MCP-launched A/B held labour at the preset
    // default while reporting itself as a controlled comparison.
    if (job.labourSystemMode) {
      if (!LABOUR_MODE_ORDER.includes(job.labourSystemMode as LabourSystemMode)) {
        throw new Error(`invalid labourSystemMode "${job.labourSystemMode}"`);
      }
      runWorldArgs.push(`--labour-mode=${job.labourSystemMode}`);
    }
    if (job.freightSettlementMode) {
      if (!(["shadow", "active"] as const).includes(job.freightSettlementMode)) {
        throw new Error(`invalid freightSettlementMode "${job.freightSettlementMode}"`);
      }
      runWorldArgs.push(`--freight-settlement=${job.freightSettlementMode}`);
    }
    if (job.canonicalFreightBillingEnabled !== undefined) {
      if (typeof job.canonicalFreightBillingEnabled !== "boolean") {
        throw new Error("canonicalFreightBillingEnabled must be boolean");
      }
      runWorldArgs.push(
        `--canonical-freight-billing=${String(job.canonicalFreightBillingEnabled)}`
      );
    }
    if (job.shortageResponsiveSourcingEnabled !== undefined) {
      if (typeof job.shortageResponsiveSourcingEnabled !== "boolean") {
        throw new Error("shortageResponsiveSourcingEnabled must be boolean");
      }
      runWorldArgs.push(
        `--shortage-responsive-sourcing=${String(job.shortageResponsiveSourcingEnabled)}`
      );
    }
    if (job.indexFundBondLiquidityEnabled !== undefined) {
      if (typeof job.indexFundBondLiquidityEnabled !== "boolean") {
        throw new Error("indexFundBondLiquidityEnabled must be boolean");
      }
      runWorldArgs.push(`--index-fund-bond-liquidity=${String(job.indexFundBondLiquidityEnabled)}`);
    }
    if (job.nppMarketCoverageEnabled !== undefined) {
      if (typeof job.nppMarketCoverageEnabled !== "boolean") {
        throw new Error("nppMarketCoverageEnabled must be boolean");
      }
      runWorldArgs.push(`--npp-market-coverage=${String(job.nppMarketCoverageEnabled)}`);
    }
    if (job.nppFragileMarketSupplyEnabled !== undefined) {
      if (typeof job.nppFragileMarketSupplyEnabled !== "boolean") {
        throw new Error("nppFragileMarketSupplyEnabled must be boolean");
      }
      runWorldArgs.push(`--npp-fragile-market-supply=${String(job.nppFragileMarketSupplyEnabled)}`);
    }
    // NPP autonomy tier. Without this an MCP-launched run silently used the
    // harness default (v3) while hand-launched runs used v4, so the two were not
    // comparable and the MCP could not reproduce a long full-world run.
    const AUTONOMY_LEVELS = ["off", "v0", "v1", "v2", "v3", "v4"];
    if (job.autonomyLevel) {
      if (!AUTONOMY_LEVELS.includes(job.autonomyLevel)) {
        throw new Error(`invalid autonomyLevel "${job.autonomyLevel}"`);
      }
      runWorldArgs.push(`--autonomy=${job.autonomyLevel}`);
    }
    // Elections-only turn profile + country scope (sim-only). runWorld.ts writes
    // gameConfig.simTurnPhaseMode (skips economy phases) and scopes election
    // spawning via countryGameStates.
    const SIM_TURN_PHASE_MODES = ["full", "elections-only"];
    if (job.mode) {
      if (!SIM_TURN_PHASE_MODES.includes(job.mode)) {
        throw new Error(`invalid mode "${job.mode}"`);
      }
      runWorldArgs.push(`--mode=${job.mode}`);
    }
    if (job.countries) {
      // Comma-separated ids become part of a child-process argv — validate each.
      const ids = job.countries
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      for (const id of ids) assertSafeToken(id, "countries[]");
      if (ids.length) runWorldArgs.push(`--countries=${ids.join(",")}`);
    }
    const { code } = await run("scripts/sim/runWorld.ts", runWorldArgs, runWorldEnv);

    clearInterval(statusMirror);
    await mirrorSandboxStatus(jobsCol, job);

    if (code !== 0) {
      await jobsCol.updateOne(
        { _id: job._id },
        {
          $set: {
            status: "failed",
            error: `runWorld.ts exited with code ${code}`,
            updatedAt: new Date(),
          },
        }
      );
      log(`Job ${job._id} FAILED (runWorld exit ${code})`);
      return;
    }

    log(`Job ${job._id} turn processing complete — collecting metrics`);
    const metricsEnv = {
      ...baseChildEnv(),
      SIM_MONGODB_URI: SIM_MONGODB_URI as string,
      OPS_MONGODB_URI: OPS_MONGODB_URI as string,
      OPS_DB_NAME,
    };
    const metricsResult = await run(
      "scripts/sim/collectMetrics.ts",
      [`--db=${job.dbName}`, `--run-id=${job._id}`],
      metricsEnv
    );

    if (metricsResult.code !== 0) {
      // The run itself succeeded — don't mark the whole job failed over a metrics
      // hiccup, but do flag it so sim_balance_report can explain a missing report.
      await jobsCol.updateOne(
        { _id: job._id },
        {
          $set: {
            status: "completed",
            metricsError: `collectMetrics.ts exited with code ${metricsResult.code}`,
            updatedAt: new Date(),
          },
        }
      );
      log(`Job ${job._id} completed but metrics collection FAILED (exit ${metricsResult.code})`);
      return;
    }

    log(`Job ${job._id} metrics collected — collecting experiments report`);
    const experimentsResult = await run(
      "scripts/sim/collectExperimentReport.ts",
      [`--db=${job.dbName}`, `--run-id=${job._id}`],
      metricsEnv // same env shape (SIM_MONGODB_URI + OPS_MONGODB_URI + OPS_DB_NAME)
    );
    if (experimentsResult.code !== 0) {
      // Same non-fatal treatment as the metrics step — the job's core work
      // (turn processing + balance report) already succeeded.
      await jobsCol.updateOne(
        { _id: job._id },
        {
          $set: {
            status: "completed",
            completedAt: new Date(),
            experimentsReportError: `collectExperimentReport.ts exited with code ${experimentsResult.code}`,
            updatedAt: new Date(),
          },
        }
      );
      log(
        `Job ${job._id} completed but experiments report collection FAILED (exit ${experimentsResult.code})`
      );
      return;
    }

    log(`Job ${job._id} experiments report collected — collecting election report`);
    const electionResult = await run(
      "scripts/sim/collectElectionReport.ts",
      [`--db=${job.dbName}`, `--run-id=${job._id}`],
      metricsEnv // same env shape (SIM_MONGODB_URI + OPS_MONGODB_URI + OPS_DB_NAME)
    );
    if (electionResult.code !== 0) {
      // Same non-fatal treatment as the other collectors — the run + balance
      // report already succeeded; a missing election report is flagged, not fatal.
      await jobsCol.updateOne(
        { _id: job._id },
        {
          $set: {
            status: "completed",
            completedAt: new Date(),
            electionReportError: `collectElectionReport.ts exited with code ${electionResult.code}`,
            updatedAt: new Date(),
          },
        }
      );
      log(
        `Job ${job._id} completed but election report collection FAILED (exit ${electionResult.code})`
      );
      return;
    }

    await jobsCol.updateOne(
      { _id: job._id },
      { $set: { status: "completed", completedAt: new Date(), updatedAt: new Date() } }
    );
    log(`Job ${job._id} COMPLETE`);
  } catch (err) {
    clearInterval(statusMirror);
    const message = err instanceof Error ? err.message : String(err);
    await jobsCol
      .updateOne(
        { _id: job._id },
        { $set: { status: "failed", error: message, updatedAt: new Date() } }
      )
      .catch(() => {});
    log(`Job ${job._id} FAILED: ${message}`);
  }
}

async function tick(jobsCol: Collection<SimJob>) {
  const job = await jobsCol.findOneAndUpdate(
    { status: "queued" },
    { $set: { status: "running", workerStartedAt: new Date(), updatedAt: new Date() } },
    { sort: { createdAt: 1 }, returnDocument: "after" }
  );
  if (!job) return;
  await processJob(jobsCol, job);
}

async function main() {
  log(`Starting — control-plane DB=${OPS_DB_NAME}, game repo=${GAME_REPO_DIR}, tick=${TICK_MS}ms`);
  const client = new MongoClient(OPS_MONGODB_URI as string);
  await client.connect();
  const jobsCol = getSimJobsCollection(client.db(OPS_DB_NAME));

  // Recover any job this worker was mid-processing when last restarted (Restart=always
  // means a crash mid-job leaves it stuck at status:"running" forever otherwise).
  await jobsCol.updateMany(
    { status: "running" },
    {
      $set: {
        status: "queued",
        error: "worker restarted mid-run, re-queued",
        updatedAt: new Date(),
      },
    }
  );

  for (;;) {
    try {
      await tick(jobsCol);
    } catch (err) {
      log(`tick error (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
}

main().catch((error) => {
  console.error("[sim-worker] FATAL:", error);
  process.exit(1);
});
