// The remediation runner: the only path through which a heal may write.
//
//   runDetect  read-only, always safe
//   runPlan    read-only, mints a state-bound confirm token
//   runApply   the writer. Needs a live token, passing guards, and a snapshot
//   runVerify  read-only, detector + invariants
//   runRollback  restores a run from its snapshot
//
// Ordering is enforced structurally rather than by convention: apply()
// re-derives the plan, checks the caller's token against that fresh plan, and
// refuses if the world moved. So an operator cannot apply a stale dry run, and
// cannot apply a plan nobody ever looked at.

import { randomBytes } from "crypto";
import type { Db } from "mongodb";
import { rollback as rollbackSnapshot, snapshot, ensureBackupIndexes } from "./backup";
import { evaluateGuards, readTurnLock, type GuardOutcome, type TurnLockState } from "./guards";
import {
  checkToken,
  consumeToken,
  ensureTokenIndexes,
  issueToken,
  readTurnNumber,
  type HealToken,
} from "./token";
import type {
  CodeGateResult,
  Defect,
  DetectResult,
  HealEnv,
  HealPlan,
  HealRun,
  VerifyResult,
} from "./types";

export const HEAL_RUNS_COLLECTION = "healRuns";

export async function ensureRemediationIndexes(db: Db): Promise<void> {
  await ensureTokenIndexes(db);
  await ensureBackupIndexes(db);
  await db.collection<HealRun>(HEAL_RUNS_COLLECTION).createIndex({ defectId: 1, startedAt: -1 });
  await db.collection<HealRun>(HEAL_RUNS_COLLECTION).createIndex({ env: 1, startedAt: -1 });
}

function assertEnvAllowed(defect: Defect, env: HealEnv): void {
  if (!defect.envs.includes(env)) {
    throw new Error(
      `[remediation] defect ${defect.id} is not registered for env "${env}" (allowed: ${defect.envs.join(", ")})`
    );
  }
}

export async function runDetect(
  db: Db,
  defect: Defect,
  args: { env: HealEnv; now?: Date }
): Promise<DetectResult> {
  assertEnvAllowed(defect, args.env);
  return defect.detect(db, { env: args.env, dryRun: true, now: args.now ?? new Date() });
}

export interface PlanOutcome {
  defectId: string;
  env: HealEnv;
  plan: HealPlan;
  detect: DetectResult;
  /** Guards as they stand right now. Advisory here, binding at apply time. */
  guards: GuardOutcome;
  turnLock: TurnLockState;
  token: { id: string; expiresAt: Date } | null;
  /** Why no token was minted (nothing to do, or a guard already fails). */
  tokenWithheld?: string;
  /**
   * Non-blocking warnings the operator must read before applying. An
   * unassessed seed lives here: it does not stop the heal, but healing live
   * data while the seed still emits the bad shape is a treadmill, and nobody
   * should learn that after the fact.
   */
  warnings: string[];
}

/** Warnings that are about the DEFECT rather than this env's data. */
export function defectWarnings(defect: Defect): string[] {
  const warnings: string[] = [];

  if (defect.seedFix.status === "unknown") {
    warnings.push(
      `SEED NOT ASSESSED: nobody has checked whether a seed reproduces ${defect.id}. ` +
        "If it does, the next world reset, era change or sandbox rebuild undoes this heal. " +
        "Set seedFix.status to fixed or not-needed once you know."
    );
  }
  if (defect.seedFix.status === "not-needed" && !defect.seedFix.note) {
    warnings.push(
      `${defect.id} claims seedFix "not-needed" with no reason recorded — say why a seed cannot produce this.`
    );
  }
  if (defect.codeFix && !defect.codeFix.requiredCommit) {
    warnings.push(
      `${defect.id} names a code fix but pins no requiredCommit, so the code gate cannot check ` +
        "whether it is actually deployed to this env. Pin it."
    );
  }
  if (!defect.codeFix) {
    warnings.push(
      `${defect.id} records no code fix. If running code still produces this shape, the heal ` +
        "buys time and nothing more. Record the code half, or say why there isn't one."
    );
  }

  return warnings;
}

export async function runPlan(
  db: Db,
  defect: Defect,
  args: { env: HealEnv; operator: string; codeGate?: CodeGateResult; now?: Date }
): Promise<PlanOutcome> {
  assertEnvAllowed(defect, args.env);
  const now = args.now ?? new Date();
  const ctx = { env: args.env, dryRun: true, now };

  const detect = await defect.detect(db, ctx);
  const plan = await defect.plan(db, ctx);
  const turnLock = await readTurnLock(db, now);
  const guards = evaluateGuards({ defect, plan, turnLock, codeGate: args.codeGate });
  const warnings = defectWarnings(defect);

  if (plan.affected === 0) {
    return {
      defectId: defect.id,
      env: args.env,
      plan,
      detect,
      guards,
      turnLock,
      token: null,
      tokenWithheld: "nothing to heal — detector found 0 affected",
      warnings,
    };
  }
  if (!guards.ok) {
    return {
      defectId: defect.id,
      env: args.env,
      plan,
      detect,
      guards,
      turnLock,
      token: null,
      tokenWithheld: `guards failing, no token issued: ${guards.refusal}`,
      warnings,
    };
  }

  await ensureTokenIndexes(db);
  const token = await issueToken(db, {
    defectId: defect.id,
    env: args.env,
    plan,
    turnNumber: turnLock.currentTurn,
    operator: args.operator,
    now,
  });

  return {
    defectId: defect.id,
    env: args.env,
    plan,
    detect,
    guards,
    turnLock,
    token: { id: token._id, expiresAt: token.expiresAt },
    warnings,
  };
}

export interface ApplyOutcome {
  ok: boolean;
  runId?: string;
  refusal?: string;
  run?: HealRun;
}

export async function runApply(
  db: Db,
  defect: Defect,
  args: {
    env: HealEnv;
    tokenId: string;
    operator: string;
    codeGate?: CodeGateResult;
    /** Required for env "prod". Sandbox and dev do not need it. */
    confirmProd?: boolean;
    now?: Date;
  }
): Promise<ApplyOutcome> {
  assertEnvAllowed(defect, args.env);
  const now = args.now ?? new Date();

  if (args.env === "prod" && args.confirmProd !== true) {
    return { ok: false, refusal: "env is prod and confirmProd was not set — refusing" };
  }

  // Re-derive from live state. Never trust the plan the caller is holding.
  const ctx = { env: args.env, dryRun: false, now };
  const freshPlan = await defect.plan(db, ctx);
  const turnNumber = await readTurnNumber(db);

  const tokenCheck = await checkToken(db, {
    tokenId: args.tokenId,
    defectId: defect.id,
    env: args.env,
    freshPlan,
    turnNumber,
    now,
  });
  if (!tokenCheck.ok) return { ok: false, refusal: tokenCheck.reason };

  const turnLock = await readTurnLock(db, now);
  const guards = evaluateGuards({ defect, plan: freshPlan, turnLock, codeGate: args.codeGate });
  if (!guards.ok) return { ok: false, refusal: guards.refusal };

  const runId = `run_${now.toISOString().slice(0, 19).replace(/[:T]/g, "")}_${randomBytes(4).toString("hex")}`;

  // Burn the token BEFORE any write. If two operators race, exactly one proceeds.
  const consumed = await consumeToken(db, args.tokenId, runId, now);
  if (!consumed) {
    return { ok: false, refusal: "token was consumed by a concurrent run — replan" };
  }

  const run: HealRun = {
    _id: runId,
    defectId: defect.id,
    env: args.env,
    startedAt: now,
    status: "running",
    operator: args.operator,
    planSummary: freshPlan.summary,
    planAffected: freshPlan.affected,
    moneyDelta: freshPlan.moneyDelta,
    codeGate: args.codeGate,
    backupCount: 0,
  };
  await db.collection<HealRun>(HEAL_RUNS_COLLECTION).insertOne(run);

  try {
    await ensureBackupIndexes(db);
    const snap = await snapshot(db, {
      runId,
      defectId: defect.id,
      touched: freshPlan.touched,
      now,
    });
    if (snap.missing.length > 0) {
      throw new Error(
        `plan names ${snap.missing.length} document(s) that no longer exist (first: ${snap.missing[0].collection}/${snap.missing[0].docId}) — plan is stale`
      );
    }
    run.backupCount = snap.backupCount;
    await db
      .collection<HealRun>(HEAL_RUNS_COLLECTION)
      .updateOne({ _id: runId }, { $set: { backupCount: snap.backupCount } });

    const result = await defect.apply(db, freshPlan, { ...ctx, runId });
    const verify = await defect.verify(db, { ...ctx, runId });

    const finished: Partial<HealRun> = {
      status: verify.ok ? "succeeded" : "failed",
      finishedAt: new Date(),
      result,
      verify,
      ...(verify.ok
        ? {}
        : {
            error: `verify failed: ${verify.remaining} still affected — ${verify.notes.join("; ")}`,
          }),
    };
    await db
      .collection<HealRun>(HEAL_RUNS_COLLECTION)
      .updateOne({ _id: runId }, { $set: finished });

    return {
      ok: verify.ok,
      runId,
      run: { ...run, ...finished } as HealRun,
      refusal: finished.error,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .collection<HealRun>(HEAL_RUNS_COLLECTION)
      .updateOne(
        { _id: runId },
        { $set: { status: "failed", finishedAt: new Date(), error: message } }
      );
    return { ok: false, runId, refusal: message };
  }
}

export async function runVerify(
  db: Db,
  defect: Defect,
  args: { env: HealEnv; now?: Date }
): Promise<VerifyResult> {
  assertEnvAllowed(defect, args.env);
  return defect.verify(db, { env: args.env, dryRun: true, now: args.now ?? new Date() });
}

export async function runRollback(
  db: Db,
  runId: string
): Promise<{ ok: boolean; detail: string; restored: number; deleted: number; notes: string[] }> {
  const run = await db.collection<HealRun>(HEAL_RUNS_COLLECTION).findOne({ _id: runId });
  if (!run)
    return { ok: false, detail: `unknown run ${runId}`, restored: 0, deleted: 0, notes: [] };
  if (run.status === "rolled-back") {
    return {
      ok: false,
      detail: `run ${runId} was already rolled back`,
      restored: 0,
      deleted: 0,
      notes: [],
    };
  }

  const summary = await rollbackSnapshot(db, { runId, result: run.result });
  await db
    .collection<HealRun>(HEAL_RUNS_COLLECTION)
    .updateOne({ _id: runId }, { $set: { status: "rolled-back", finishedAt: new Date() } });

  return {
    ok: true,
    detail: `restored ${summary.restored} document(s), deleted ${summary.deleted} inserted document(s)`,
    restored: summary.restored,
    deleted: summary.deleted,
    notes: summary.notes,
  };
}

export async function listHistory(
  db: Db,
  args: { defectId?: string; env?: HealEnv; limit?: number } = {}
): Promise<HealRun[]> {
  const filter: Record<string, unknown> = {};
  if (args.defectId) filter.defectId = args.defectId;
  if (args.env) filter.env = args.env;
  return db
    .collection<HealRun>(HEAL_RUNS_COLLECTION)
    .find(filter)
    .sort({ startedAt: -1 })
    .limit(Math.min(args.limit ?? 25, 200))
    .toArray();
}

export type { HealToken };
