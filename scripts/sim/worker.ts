/**
 * Sim job-queue worker. Polls the control-plane `simJobs` collection (the SAME
 * production Mongo the live game and the ops-dashboard's worldsim MCP use —
 * orchestration metadata only, alongside the existing `sim_scenarios`
 * collection) for queued runs, and drives each one through child processes:
 * scripts/sim/runWorld.ts (turn engine) then the report collectors
 * (collectMetrics, collectExperimentReport, collectElectionReport), all
 * against an isolated sandbox MongoDB — never the control-plane DB and
 * never production game data. Pinned jobs (#1966, #2083) run every child
 * from the same validated source worktree.
 *
 * Deliberately NOT using @/lib/mongodb's getDb() singleton for the
 * control-plane connection: that singleton gets permanently pinned to
 * whichever DB the first import resolves, and each job needs the *child*
 * processes (not this one) pinned to a *different* (sandbox) DB per run. A
 * raw MongoClient here keeps this process's own DB connection independent of
 * whatever the children do in their own processes.
 *
 * Runs a small bounded pool. Each slot is a separate child process and database;
 * admission remains conservative because this shares a production host.
 *
 * Required env:
 *   OPS_MONGODB_URI   — control-plane DB (simJobs collection)
 *   SIM_MONGODB_URI   — sandbox MongoDB for actual world simulation
 *   GAME_REPO_DIR     — absolute path to the a-house-divided checkout to run
 *                        scripts/sim/{runWorld,collectMetrics}.ts from
 *
 * Usage: npx tsx scripts/sim/worker.ts
 */

import { dirname, join } from "path";
import { cpus, freemem, hostname, loadavg } from "os";
import { MongoClient, type Db, type Collection, type Filter } from "mongodb";
import { claimFilterAt, parseClaimWindow } from "./claimWindow";
import {
  claimNextJob,
  createHandoffController,
  findLiveEngineRunIdsFromCmdlines,
  listProcessCmdlines,
  recoverLegacyOrphans,
  recoverStaleLeases,
  type HandoffJob,
  type HandoffStore,
} from "./simJobHandoff";
import { spawnWithPrefixedLogs, type ChildRunIdentity } from "./childLogPrefix";
import { assertSafeToken } from "./simJobArgs";
import { resolveSimPreset } from "./simPreset";
import { buildStatusMirrorUpdate, type SandboxProgress } from "./simStatusMirror";
import type { GameHealthSummary } from "@/lib/db/types/gameHealthSnapshot";
import { defaultSimSourceDeps, planRunWorldSpawn, verifySimSource } from "./simSource";
import { planCollectorSpawns } from "./collectorSource";
import {
  pickSovereignDemandExperimentFlags,
  sovereignDemandRunWorldArgs,
} from "./sovereignDemandExperimentFlags";

const OPS_MONGODB_URI = process.env.OPS_MONGODB_URI;
const OPS_DB_NAME = process.env.OPS_DB_NAME || "a-house-divided";
const SIM_MONGODB_URI = process.env.SIM_MONGODB_URI;
const GAME_REPO_DIR = process.env.GAME_REPO_DIR || process.cwd();
const TICK_MS = Number(process.env.SIM_WORKER_TICK_MS || "15000");
const CONCURRENCY = Math.max(1, Math.min(2, Number(process.env.SIM_WORKER_CONCURRENCY || "2")));
const MIN_FREE_BYTES = Number(process.env.SIM_WORKER_MIN_FREE_BYTES || String(16 * 1024 ** 3));
const MAX_LOAD_RATIO = Number(process.env.SIM_WORKER_MAX_LOAD_RATIO || "0.7");
// Collection/report phases do not mirror sandbox turns. Ten minutes avoids
// reclaiming a live collector while still recovering a dead worker durably.
const LEASE_STALE_MS = Number(process.env.SIM_WORKER_LEASE_STALE_MS || "600000");
const WORKER_INSTANCE_ID = `${hostname()}:${process.pid}`;
// The LIVE game DB — required only for cloneFromLive jobs. NOT the same thing
// as OPS_MONGODB_URI: on the ops box the control-plane (simJobs) lives on the
// local Mongo while the live game lives on the hosted prod cluster. Cloning
// from the control-plane URI silently copies sim metadata and bootstraps a
// fresh world, which defeats the entire point of a clone run.
const LIVE_MONGODB_URI = process.env.LIVE_MONGODB_URI;
const LIVE_DB_NAME = process.env.LIVE_DB_NAME || "a-house-divided";
const STATUS_MIRROR_MS = Number(process.env.SIM_WORKER_STATUS_MIRROR_MS || "20000");
const CLAIM_WINDOW = parseClaimWindow(
  process.env.SIM_WORKER_CLAIM_WINDOW,
  process.env.SIM_WORKER_CLAIM_TIMEZONE || "America/New_York"
);

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

interface SimJob {
  _id: string;
  status: "queued" | "running" | "completed" | "failed";
  preset: string;
  presetNormalizedFrom?: string;
  presetNormalizedAt?: Date;
  turns: number;
  seed: string;
  dbName: string;
  startPolicy?: "immediate" | "window";
  marketSystemMode?: string;
  labourSystemMode?: string;
  freightSettlementMode?: "shadow" | "active";
  canonicalFreightBillingEnabled?: boolean;
  shortageResponsiveSourcingEnabled?: boolean;
  indexFundBondLiquidityEnabled?: boolean;
  sovereignIssuanceConsolidationEnabled?: boolean;
  domesticSovereignBondCoverageEnabled?: boolean;
  equityLiquidityFacilityEnabled?: boolean;
  nppMarketCoverageEnabled?: boolean;
  nppFragileMarketSupplyEnabled?: boolean;
  // Frontier-entry experiment gate (issue #991, gameState flag). Explicit
  // false is a pinned control arm, not an omission: it must reach runWorld.
  frontierEntryExperimentEnabled?: boolean;
  allFeatureFlags?: boolean;
  autonomyLevel?: string;
  /** Simulation actor mode (#1993). Omitted means pure NPP autonomy.
   * Flows into runWorld via planRunWorldSpawn -> buildRunWorldArgs. */
  actors?: "pure-npp" | "synthetic";
  /** Sim turn-phase profile: "elections-only" skips the economy phases. Default full. */
  mode?: "full" | "elections-only";
  /** Elections-only country scope: comma-separated ids (e.g. "US,UK,DE"). Omit for global. */
  countries?: string;
  /** Clone the LIVE world into the sandbox db first, then run --clone-mode.
   * Quick before/after validation of deployed code on real state. */
  cloneFromLive?: boolean;
  /** Pinned source revision (issue #1966). Both set or both absent; when set,
   * runWorld executes from the verified worktree at exactly this commit. */
  sourceWorktree?: string;
  sourceCommit?: string;
  /** Executed source identity, stamped by the worker after verification. */
  sourceRepoDir?: string;
  sourceCommitVerified?: string;
  createdAt: Date;
  updatedAt: Date;
  workerStartedAt?: Date;
  currentTurn?: number;
  lastMessage?: string;
  lastWarnings?: string[];
  health?: GameHealthSummary | null;
  error?: string | null;
  workerInstanceId?: string;
  workerSlotId?: number;
  heartbeatAt?: Date;
  workerHeartbeatAt?: Date;
  progressUpdatedAt?: Date;
  workerPhase?: string;
}

function log(msg: string) {
  console.log(`[sim-worker] ${msg}`);
}

// Controlled-restart drain switch (#2069). The promotion path signals the
// outgoing worker while its awaited job is still running; the worker then
// finishes active jobs and claims nothing new, so no successor is orphaned
// mid-handoff. Running simulations are never interrupted.
const handoff = createHandoffController();
process.once("SIGTERM", () => {
  handoff.requestShutdown();
  log("shutdown requested (SIGTERM): draining active jobs, claiming nothing new");
});
process.once("SIGINT", () => {
  handoff.requestShutdown();
  log("shutdown requested (SIGINT): draining active jobs, claiming nothing new");
});

/** Adapt the control-plane collection to the handoff store interface. Claim
 * stays one atomic findOneAndUpdate; the legacy requeue stays conditional on
 * the row still being unleased, so a fresh claim can never be clobbered. */
function mongoHandoffStore(jobsCol: Collection<SimJob>): HandoffStore {
  return {
    async claimOne(filter, update): Promise<HandoffJob | null> {
      const queued: Filter<SimJob> =
        filter.startPolicy === undefined
          ? { status: "queued" }
          : { status: "queued", startPolicy: filter.startPolicy };
      const job = await jobsCol.findOneAndUpdate(
        { $and: [queued, { dbName: { $nin: filter.excludeDbNames } }] },
        // $unset mirrors update.unset (["error"]): kept as a typed literal
        // because the driver does not accept a computed $unset object.
        {
          $set: update.set,
          $unset: { error: "" },
        },
        { sort: { createdAt: 1 }, returnDocument: "after" }
      );
      return (job ?? null) as unknown as HandoffJob | null;
    },
    async requeueStaleLeases(staleBefore, error, now): Promise<number> {
      const result = await jobsCol.updateMany(
        {
          status: "running",
          workerInstanceId: { $exists: true },
          heartbeatAt: { $lt: staleBefore },
        },
        {
          $set: { status: "queued", error, updatedAt: now },
          $unset: { workerInstanceId: "", workerSlotId: "", workerPhase: "" },
        }
      );
      return result.modifiedCount;
    },
    async listUnleasedRunning(): Promise<HandoffJob[]> {
      const docs = await jobsCol
        .find({ status: "running", workerInstanceId: { $exists: false } })
        .toArray();
      return docs as unknown as HandoffJob[];
    },
    async requeueLegacyOrphan(id, error, now): Promise<boolean> {
      const result = await jobsCol.updateOne(
        { _id: id, status: "running", workerInstanceId: { $exists: false } },
        {
          $set: { status: "queued", error, updatedAt: now },
          $unset: { workerInstanceId: "", workerSlotId: "", workerPhase: "" },
        }
      );
      return result.matchedCount === 1;
    },
  };
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
  env: NodeJS.ProcessEnv,
  cwd: string,
  identity: ChildRunIdentity
): Promise<{ code: number | null }> {
  // #2071: pipe (never inherit) so every child line is prefixed with the run
  // identity at ingestion time. Covers the whole child lifetime, not just
  // startup helpers, so slots sharing one journal stay attributable.
  return spawnWithPrefixedLogs(NPX_PATH, ["tsx", script, ...args], identity, undefined, {
    cwd,
    env,
  });
}

async function mirrorSandboxStatus(jobsCol: Collection<SimJob>, job: SimJob) {
  const client = new MongoClient(SIM_MONGODB_URI as string);
  try {
    await client.connect();
    const doc = await client
      .db(job.dbName)
      .collection<SandboxProgress & { _id: string }>("simRuns")
      .findOne({ _id: job._id as never });
    if (doc) {
      const now = new Date();
      const mirrored = buildStatusMirrorUpdate(job, doc, now);
      await jobsCol.updateOne(
        { _id: job._id },
        {
          $set: {
            ...mirrored,
            // #1992: surface the fresh-bootstrap conformance summary on the
            // job manifest so the queue shows seed provenance, not just turns.
            ...(doc.bootstrapConformance ? { bootstrapConformance: doc.bootstrapConformance } : {}),
          },
        }
      );
      Object.assign(job, mirrored);
    } else {
      const now = new Date();
      await jobsCol.updateOne(
        { _id: job._id, status: "running", workerInstanceId: WORKER_INSTANCE_ID },
        { $set: { heartbeatAt: now, workerHeartbeatAt: now } }
      );
    }
  } catch (err) {
    // Best-effort — a missed status mirror tick is not worth failing the job over.
    log(`status mirror failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client.close();
  }
}

async function processJob(jobsCol: Collection<SimJob>, job: SimJob, slotId: number) {
  // Validate before this job's fields touch a Mongo db name or a child-process
  // argv — see SAFE_TOKEN above. A job document only ever comes from this
  // worker's own findOneAndUpdate claim (tick()) or the worldsim MCP's
  // sim_run_world insert, but defense in depth costs nothing here.
  assertSafeToken(job._id, "_id");
  assertSafeToken(job.seed, "seed");
  assertSafeToken(job.preset, "preset");
  const resolvedPreset = resolveSimPreset(job.preset);
  if (resolvedPreset !== job.preset) {
    await jobsCol.updateOne(
      { _id: job._id },
      {
        $set: {
          preset: resolvedPreset,
          presetNormalizedFrom: job.preset,
          presetNormalizedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );
    job.preset = resolvedPreset;
  }
  assertSafeToken(job.dbName, "dbName");
  if (job.dbName === OPS_DB_NAME) {
    throw new Error(
      `Job dbName "${job.dbName}" collides with the control-plane OPS_DB_NAME — refusing to run.`
    );
  }
  if (!Number.isInteger(job.turns) || job.turns <= 0 || job.turns > 5000) {
    throw new Error(`Job turns must be a positive integer <= 5000, got ${job.turns}`);
  }
  // Pinned source (#1966): fail fast on an invalid pin before any clone or
  // spawn work. Read-only git checks only - the worker never fetches,
  // checks out, resets, or otherwise mutates the shared worktree.
  const verifiedSource = verifySimSource(job, defaultSimSourceDeps());
  if (verifiedSource) {
    await jobsCol.updateOne(
      { _id: job._id },
      {
        $set: {
          sourceRepoDir: verifiedSource.repoDir,
          sourceCommitVerified: verifiedSource.commit,
          updatedAt: new Date(),
        },
      }
    );
  }

  // #2071: stable identity stamped onto every line of every child this job
  // spawns (clone, turns, metrics, experiments, elections).
  const childIdentity: ChildRunIdentity = {
    runId: job._id,
    seed: job.seed,
    dbName: job.dbName,
    slot: slotId,
    workerInstance: WORKER_INSTANCE_ID,
  };

  log(
    `[slot ${slotId}] Claimed job ${job._id} (preset=${job.preset}, turns=${job.turns}, db=${job.dbName})`
  );

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
        cloneEnv,
        GAME_REPO_DIR,
        childIdentity
      );
      if (cloneResult.code !== 0) {
        throw new Error(`cloneWorld exited with code ${cloneResult.code}`);
      }
      log(`Clone complete; running ${job.turns} turn(s) in clone mode`);
    }
    // Re-verify immediately before spawn: the worktree is shared, so HEAD
    // may have moved or dirtied since the claim-time check. Fail closed.
    const spawnSource = verifySimSource(job, defaultSimSourceDeps());
    if (verifiedSource && (!spawnSource || spawnSource.commit !== verifiedSource.commit)) {
      throw new Error(
        `Pinned source moved between validation and spawn for job ${job._id} - refusing to run`
      );
    }
    // #1001 controlled comparison: both dark gates travel from the simJobs
    // doc to runWorld CLI args through one shared, tested mapping. Absent
    // stays absent (scheduler default off); explicit false pins the control
    // arm; non-boolean values throw and fail the job, like every neighbor.
    // They ride the spawn-plan base args so the pinned-source planner keeps
    // owning cwd, experiment args, and provenance flags.
    const sovereignDemandBaseArgs = sovereignDemandRunWorldArgs(
      pickSovereignDemandExperimentFlags({ ...job })
    );
    const spawnPlan = planRunWorldSpawn(
      job,
      [
        `--seed=${job.seed}`,
        `--preset=${job.preset}`,
        `--turns=${job.turns}`,
        `--db=${job.dbName}`,
        `--run-id=${job._id}`,
        ...(job.cloneFromLive ? ["--clone-mode"] : []),
        ...sovereignDemandBaseArgs,
      ],
      GAME_REPO_DIR,
      spawnSource
    );
    if (spawnSource) {
      log(`Running from pinned source ${spawnSource.repoDir} @ ${spawnSource.commit}`);
    }
    const { code } = await run(
      "scripts/sim/runWorld.ts",
      spawnPlan.args,
      runWorldEnv,
      spawnPlan.cwd,
      childIdentity
    );

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

    // #2083: revalidate the pinned worktree immediately before collection —
    // the tree is shared, so HEAD may have moved or dirtied during the turn
    // run. Fail closed, exactly like the pre-spawn check above. Collectors
    // then execute from this same validated cwd and re-check HEAD themselves.
    const collectSource = verifySimSource(job, defaultSimSourceDeps());
    if (verifiedSource && (!collectSource || collectSource.commit !== verifiedSource.commit)) {
      throw new Error(
        `Pinned source moved between spawn and collection for job ${job._id} - refusing to collect`
      );
    }
    const collectorPlans = planCollectorSpawns(
      { dbName: job.dbName, runId: job._id },
      GAME_REPO_DIR,
      collectSource
    );
    if (collectSource) {
      log(
        `Collecting reports from pinned source ${collectSource.repoDir} @ ${collectSource.commit}`
      );
    }
    await jobsCol.updateOne(
      { _id: job._id },
      { $set: { workerPhase: "metrics", heartbeatAt: new Date(), updatedAt: new Date() } }
    );
    log(`[slot ${slotId}] Job ${job._id} turn processing complete — collecting metrics`);
    const metricsEnv = {
      ...baseChildEnv(),
      SIM_MONGODB_URI: SIM_MONGODB_URI as string,
      OPS_MONGODB_URI: OPS_MONGODB_URI as string,
      OPS_DB_NAME,
    };
    const metricsResult = await run(
      collectorPlans[0].script,
      collectorPlans[0].args,
      metricsEnv,
      collectorPlans[0].cwd,
      childIdentity
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

    await jobsCol.updateOne(
      { _id: job._id },
      { $set: { workerPhase: "experiments", heartbeatAt: new Date(), updatedAt: new Date() } }
    );
    log(`[slot ${slotId}] Job ${job._id} metrics collected — collecting experiments report`);
    const experimentsResult = await run(
      collectorPlans[1].script,
      collectorPlans[1].args,
      metricsEnv, // same env shape (SIM_MONGODB_URI + OPS_MONGODB_URI + OPS_DB_NAME)
      collectorPlans[1].cwd,
      childIdentity
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

    await jobsCol.updateOne(
      { _id: job._id },
      { $set: { workerPhase: "elections", heartbeatAt: new Date(), updatedAt: new Date() } }
    );
    log(
      `[slot ${slotId}] Job ${job._id} experiments report collected — collecting election report`
    );
    const electionResult = await run(
      collectorPlans[2].script,
      collectorPlans[2].args,
      metricsEnv, // same env shape (SIM_MONGODB_URI + OPS_MONGODB_URI + OPS_DB_NAME)
      collectorPlans[2].cwd,
      childIdentity
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
      {
        $set: {
          status: "completed",
          completedAt: new Date(),
          workerPhase: "complete",
          updatedAt: new Date(),
        },
      }
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

function hasCapacity(): boolean {
  return freemem() >= MIN_FREE_BYTES && loadavg()[0] < cpus().length * MAX_LOAD_RATIO;
}

async function tick(jobsCol: Collection<SimJob>, slotId: number, activeDbNames: string[]) {
  // A running simulation is never interrupted at the window boundary. The
  // window controls admission of the next queued job only.
  if (!hasCapacity()) return null;
  const claimFilter = claimFilterAt(new Date(), CLAIM_WINDOW);
  const job = await claimNextJob(mongoHandoffStore(jobsCol), {
    filter: {
      ...(claimFilter.startPolicy ? { startPolicy: claimFilter.startPolicy } : {}),
      excludeDbNames: activeDbNames,
    },
    slotId,
    workerInstanceId: WORKER_INSTANCE_ID,
    now: new Date(),
    shutdownRequested: handoff.isShutdownRequested(),
  });
  if (!job) return null;
  return job as unknown as SimJob;
}

async function main() {
  log(
    `Starting — control-plane DB=${OPS_DB_NAME}, game repo=${GAME_REPO_DIR}, tick=${TICK_MS}ms, slots=${CONCURRENCY}`
  );
  if (CLAIM_WINDOW) {
    log(`Claim window=${process.env.SIM_WORKER_CLAIM_WINDOW} ${CLAIM_WINDOW.timeZone}`);
  }
  const client = new MongoClient(OPS_MONGODB_URI as string);
  await client.connect();
  const jobsCol = getSimJobsCollection(client.db(OPS_DB_NAME));

  const active = new Map<number, { job: SimJob; promise: Promise<void> }>();
  const store = mongoHandoffStore(jobsCol);

  for (;;) {
    try {
      const now = new Date();
      const staleBefore = new Date(now.getTime() - LEASE_STALE_MS);
      await recoverStaleLeases(store, staleBefore, now);
      // Legacy (pre-lease) orphan sweep (#2069). The probe must positively
      // show no matching engine process before a row is requeued; when the
      // process table cannot be listed it returns null and this pass recovers
      // nothing rather than risk requeueing a live legacy run.
      const cmdlines = listProcessCmdlines();
      if (cmdlines !== null) {
        const recovered = await recoverLegacyOrphans(
          store,
          findLiveEngineRunIdsFromCmdlines(cmdlines),
          now
        );
        for (const id of recovered) {
          log(`recovered orphaned legacy claim ${id} (no lease, no live engine process)`);
        }
      }
      for (let slotId = 1; slotId <= CONCURRENCY; slotId += 1) {
        if (active.has(slotId)) continue;
        const job = await tick(
          jobsCol,
          slotId,
          [...active.values()].map((entry) => entry.job.dbName)
        );
        if (!job) continue;
        const promise = processJob(jobsCol, job, slotId).finally(() => active.delete(slotId));
        active.set(slotId, { job, promise });
      }
      if (handoff.isShutdownRequested() && active.size === 0) {
        log("drain complete: no active jobs, exiting");
        break;
      }
    } catch (err) {
      log(`tick error (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
  await client.close();
}

main().catch((error) => {
  console.error("[sim-worker] FATAL:", error);
  process.exit(1);
});
