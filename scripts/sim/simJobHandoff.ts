/**
 * Controlled-restart handoff protocol for the sim job queue (issue #2069).
 *
 * A legacy worker claimed jobs without writing lease metadata
 * (workerInstanceId / heartbeatAt). When a controlled restart stopped that
 * worker after it claimed a successor, the row stayed `running` forever: the
 * lease-based stale recovery ignored it (no lease to be stale) and no fresh
 * claim could match it (not `queued`). This module owns the recovery rules so
 * the worker and its tests share one code path:
 *
 * - drain: once shutdown is requested the outgoing worker finishes its active
 *   jobs but claims nothing new;
 * - claim: a successful claim always clears stale `error` text left by a
 *   previous recovery;
 * - legacy recovery: an unleased `running` row returns to `queued` only after
 *   a process-table probe proves no matching engine process is alive. A probe
 *   that cannot list processes, or a live match, fails closed (no recovery).
 *
 * Pure logic plus a narrow store interface. The worker adapts its Mongo
 * collection to the interface; tests use an in-memory fake.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const STALE_LEASE_RECOVERY_ERROR = "stale worker lease recovered";
export const LEGACY_ORPHAN_RECOVERY_ERROR = "orphaned legacy claim recovered";

/** Statuses that end a job. A recovered row must never be terminal. */
const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export interface HandoffJob {
  _id: string;
  status: string;
  createdAt: Date;
  updatedAt?: Date;
  dbName: string;
  startPolicy?: string;
  error?: string | null;
  workerInstanceId?: string;
  workerSlotId?: number;
  heartbeatAt?: Date;
  workerHeartbeatAt?: Date;
  workerPhase?: string;
}

export interface ClaimFilter {
  /** Narrowest queued subset the claim window admits this tick. */
  startPolicy?: "immediate";
  excludeDbNames: string[];
}

/** Exact fields a successful claim stamps. Kept concrete (not a generic record)
 * so the Mongo adapter passes it straight into a typed `$set`. */
export interface ClaimSet {
  status: "running";
  workerStartedAt: Date;
  updatedAt: Date;
  heartbeatAt: Date;
  workerInstanceId: string;
  workerSlotId: number;
  workerPhase: "starting";
}

export interface ClaimUpdate {
  set: ClaimSet;
  unset: string[];
}

export interface HandoffStore {
  /** Atomic find-one-and-claim of the oldest admissible queued job. */
  claimOne(filter: ClaimFilter, update: ClaimUpdate): Promise<HandoffJob | null>;
  /** Requeue leased `running` rows whose heartbeat predates the cutoff. */
  requeueStaleLeases(staleBefore: Date, error: string, now: Date): Promise<number>;
  /** Every `running` row with no lease metadata. */
  listUnleasedRunning(): Promise<HandoffJob[]>;
  /**
   * Conditional unleased-running to queued transition. Returns false when the
   * row no longer qualifies (claimed or finished concurrently), so a fresh
   * claim is never clobbered.
   */
  requeueLegacyOrphan(id: string, error: string, now: Date): Promise<boolean>;
}

/** A row a legacy (pre-lease) worker left behind: running, no lease fields. */
export function isUnleasedRunningJob(job: HandoffJob): boolean {
  return (
    job.status === "running" &&
    (job.workerInstanceId === undefined || job.workerInstanceId === null) &&
    (job.heartbeatAt === undefined || job.heartbeatAt === null) &&
    (job.workerHeartbeatAt === undefined || job.workerHeartbeatAt === null)
  );
}

/** Claim update for a job starting (or restarting) execution. Clears the stale
 * `error` text a previous recovery pass left, so a recovered job that starts
 * successfully does not carry its recovery note forever. */
export function buildClaimUpdate(args: {
  slotId: number;
  workerInstanceId: string;
  now: Date;
}): ClaimUpdate {
  return {
    set: {
      status: "running",
      workerStartedAt: args.now,
      updatedAt: args.now,
      heartbeatAt: args.now,
      workerInstanceId: args.workerInstanceId,
      workerSlotId: args.slotId,
      workerPhase: "starting",
    },
    unset: ["error"],
  };
}

/**
 * Outgoing-worker drain switch. The promotion/restart path requests shutdown
 * while the awaited job is still running; the worker then finishes active jobs
 * and claims nothing new, so no successor is orphaned mid-handoff.
 */
export function createHandoffController(): {
  requestShutdown: () => void;
  isShutdownRequested: () => boolean;
  canClaim: () => boolean;
} {
  let shutdownRequested = false;
  return {
    requestShutdown: () => {
      shutdownRequested = true;
    },
    isShutdownRequested: () => shutdownRequested,
    canClaim: () => !shutdownRequested,
  };
}

/**
 * Single atomic claim attempt. Returns null without touching the store when
 * the worker is draining. Otherwise claims the oldest admissible queued job,
 * clearing any stale `error` text on success.
 */
export async function claimNextJob(
  store: HandoffStore,
  args: {
    filter: ClaimFilter;
    slotId: number;
    workerInstanceId: string;
    now: Date;
    shutdownRequested: boolean;
  }
): Promise<HandoffJob | null> {
  if (args.shutdownRequested) return null;
  return store.claimOne(
    args.filter,
    buildClaimUpdate({
      slotId: args.slotId,
      workerInstanceId: args.workerInstanceId,
      now: args.now,
    })
  );
}

/** Requeue leased `running` rows with a stale heartbeat. Unleased legacy rows
 * are out of scope here; recoverLegacyOrphans handles them. */
export async function recoverStaleLeases(
  store: HandoffStore,
  staleBefore: Date,
  now: Date
): Promise<number> {
  return store.requeueStaleLeases(staleBefore, STALE_LEASE_RECOVERY_ERROR, now);
}

/**
 * Requeue unleased `running` rows only for run ids with proven absence of a
 * matching engine process. `liveRunIds` null means the probe could not list
 * processes: fail closed and recover nothing. Never touches terminal rows and
 * never requeues a genuinely active legacy process.
 */
export async function recoverLegacyOrphans(
  store: HandoffStore,
  liveRunIds: Set<string> | null,
  now: Date
): Promise<string[]> {
  if (liveRunIds === null) return [];
  const candidates = await store.listUnleasedRunning();
  const recovered: string[] = [];
  for (const job of candidates) {
    if (TERMINAL_STATUSES.has(job.status)) continue;
    if (!isUnleasedRunningJob(job)) continue;
    if (liveRunIds.has(job._id)) continue;
    const ok = await store.requeueLegacyOrphan(job._id, LEGACY_ORPHAN_RECOVERY_ERROR, now);
    if (ok) recovered.push(job._id);
  }
  return recovered;
}

/** Extract engine run ids from process command lines. Children run as
 * `npx tsx scripts/sim/runWorld.ts ... --run-id=<jobId>`, so a legacy engine
 * process still working a job advertises that job's id on its cmdline. */
export function findLiveEngineRunIdsFromCmdlines(cmdlines: string[]): Set<string> {
  const live = new Set<string>();
  for (const cmdline of cmdlines) {
    const match = /--run-id=([^\s\0]+)/.exec(cmdline);
    if (match) live.add(match[1]);
  }
  return live;
}

/**
 * Raw command lines of every local process, or null when they cannot be
 * listed (non-Linux host, unreadable /proc). Null must fail closed: without a
 * listing, absence of an engine process is unproven.
 */
export function listProcessCmdlines(): string[] | null {
  try {
    const entries = readdirSync("/proc");
    const cmdlines: string[] = [];
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const raw = readFileSync(join("/proc", entry, "cmdline"), "utf8");
        if (raw.length > 0) cmdlines.push(raw.replaceAll("\0", " "));
      } catch {
        continue;
      }
    }
    return cmdlines;
  } catch {
    return null;
  }
}
