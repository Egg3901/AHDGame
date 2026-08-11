/**
 * One reset run's failure list and outcome.
 *
 * A reset used to be all-or-nothing with no record: `bootstrapGameWorld` and
 * `resetGameWorld` contain zero try/catch between them, and the audit row was
 * written in FINALIZE — so a run that died in teardown left the world sealed
 * (B2 seals before anything is destroyed) and half-built, with no trace of what
 * happened once the admin's browser tab closed.
 *
 * Recovery is deliberately RE-RUN, not resume: the reset is ~100s, teardown
 * wipes runtime state anyway, and every seeder is idempotent. So this module
 * carries no checkpoint state — it exists for diagnosis and visibility.
 */
import { ObjectId, type Db } from "mongodb";
import type { AdminLog } from "@/lib/db/types/adminLog";
import type { GameConfig } from "@/lib/db/types";

const LOG_TAIL_LINES = 200;

/** A recoverable step that threw. The run continues; the outcome degrades. */
export interface ResetRunFailure {
  phase: string;
  name: string;
  error: string;
}

export type ResetRunStatus = "succeeded" | "partial" | "failed";

export interface ResetRunRecord {
  runId: string;
  failures: ResetRunFailure[];
  /**
   * Run `fn`, containing any throw. Returns `null` instead of throwing, so a
   * recoverable seeder cannot abort a reset that is otherwise fine.
   *
   * ⚠️ Only for RECOVERABLE work. Structural steps — the seal, teardown,
   * `runSeed`'s core, the clock stamp, the commandEconomy gate write — must
   * stay a bare `await` and abort, because nothing downstream is meaningful
   * without them.
   *
   * Deliberately the same shape `spawnFoundingElections` already uses per
   * family, so the codebase has one isolation idiom rather than two.
   */
  step<T>(phase: string, name: string, fn: () => Promise<T>): Promise<T | null>;
  /** `aborted` = a structural phase threw and the run stopped early. */
  status(aborted: boolean): ResetRunStatus;
}

/**
 * @param log Sink for contained failures. WITHOUT this a contained seeder is
 *   invisible to the operator: the failure reaches the audit row, but the admin
 *   watching the SSE stream sees the reset finish with no sign anything broke —
 *   and the summary prints "Demographics reset: 0", which reads as "nothing to
 *   do" rather than "that step died".
 */
export function createResetRunRecord(log?: (msg: string) => void): ResetRunRecord {
  const failures: ResetRunFailure[] = [];
  return {
    // Not timestamp-derived: two resets may legitimately start in the same
    // second, and the concurrency lock (B1) was declined.
    runId: new ObjectId().toHexString(),
    failures,
    async step<T>(phase: string, name: string, fn: () => Promise<T>): Promise<T | null> {
      try {
        return await fn();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ phase, name, error: message });
        log?.(`⚠ ${phase}/${name} FAILED and was contained: ${message}`);
        return null;
      }
    },
    status(aborted: boolean): ResetRunStatus {
      if (aborted) return "failed";
      return failures.length > 0 ? "partial" : "succeeded";
    },
  };
}

/**
 * Insert the run's audit row BEFORE anything is destroyed.
 *
 * ⚠️ The ordering IS the fix. This row used to be written in finalize (phase
 * 2b), so a reset that died in teardown left nothing behind. It survives the
 * teardown it records because `adminLogs` is manifest category `preserved` —
 * "Reset writes a new game_reset entry but never wipes the collection".
 *
 * Deliberately NOT gated on `adminUsername`. The old insert was, so a
 * script-driven reset produced no audit row at all.
 */
export async function openResetRunLog(
  db: Db,
  run: ResetRunRecord,
  ctx: { preset: string; mode: string; adminUsername?: string }
): Promise<void> {
  const now = new Date();
  await db.collection<AdminLog>("adminLogs").insertOne({
    category: "system",
    action: "game_reset",
    username: "SYSTEM",
    adminUsername: ctx.adminUsername,
    createdAt: now,
    resetRun: {
      runId: run.runId,
      status: "running",
      preset: ctx.preset,
      mode: ctx.mode,
      startedAt: now,
    },
  } as AdminLog);
}

export interface ResetRunOutcome {
  status: ResetRunStatus;
  phaseReached: string;
  details: string;
  logs: string[];
  /** Set for a full reset so the row's action matches the previous behaviour. */
  deleteProfiles?: boolean;
  adminUsername?: string;
}

/**
 * Stamp the run's outcome onto its row and onto `gameConfig.lastReset`.
 *
 * ⚠️ Best-effort by design. This runs in the orchestrator's `finally`, so a
 * throw here would replace the reset's real error with a bookkeeping one —
 * and the most likely reason it fails is that the database is exactly what
 * died. Same rule the diagnostic's error-report persistence already follows.
 */
export async function closeResetRunLog(
  db: Db,
  run: ResetRunRecord,
  outcome: ResetRunOutcome
): Promise<void> {
  const finishedAt = new Date();
  try {
    await db.collection<AdminLog>("adminLogs").updateOne(
      { "resetRun.runId": run.runId } as never,
      {
        $set: {
          action: outcome.deleteProfiles ? "game_full_reset" : "game_reset",
          details: outcome.details,
          "resetRun.status": outcome.status,
          "resetRun.phaseReached": outcome.phaseReached,
          "resetRun.failures": run.failures,
          "resetRun.finishedAt": finishedAt,
          "resetRun.logTail": outcome.logs.slice(-LOG_TAIL_LINES),
        },
      } as never
    );
  } catch {
    // Swallowed on purpose — see the docstring.
  }

  try {
    await db.collection<GameConfig>("gameConfig").updateOne(
      { _id: "default" },
      {
        $set: {
          lastReset: {
            runId: run.runId,
            status: outcome.status,
            phaseReached: outcome.phaseReached,
            at: finishedAt,
            by: outcome.adminUsername,
          },
        },
      } as never,
      { upsert: true }
    );
  } catch {
    // Swallowed on purpose — see the docstring.
  }
}
