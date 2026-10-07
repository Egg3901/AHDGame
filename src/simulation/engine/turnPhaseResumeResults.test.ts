import { describe, expect, it, vi } from "vitest";
import type { TurnPhaseTelemetryMap } from "@/lib/db/types";
import type { BondTurnResult } from "@/lib/turn/bondTurn";
import { createTurnPhaseRuntime } from "@/simulation/engine/turnPhaseRuntime";
import {
  isResumeFailClosedError,
  readCrashedTurnPhaseState,
  TurnPhaseCompletionPersistError,
  TurnResumeResultUnavailableError,
} from "@/simulation/engine/turnPhaseResumeResults";
import {
  bootstrapPhaseRecord,
  lockAcquisitionSet,
  staleRecoveryEvidenceReset,
  validateLockedResume,
} from "@/simulation/engine/turnResumeBootstrap";

vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));

/** A gameState document that applies the runtime's dotted `$set` writes. */
function createGameStateDb(failWhen?: (set: Record<string, unknown>) => boolean) {
  const doc: Record<string, unknown> = {
    _id: "current",
    isProcessing: true,
    processingPhaseStatuses: {},
    processingPhaseResults: {},
  };
  const updateOne = vi.fn(async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
    if (failWhen?.(update.$set)) throw new Error("primary stepped down");
    for (const [path, value] of Object.entries(update.$set)) {
      const parts = path.split(".");
      let target = doc;
      for (const part of parts.slice(0, -1)) {
        if (target[part] === null || typeof target[part] !== "object") {
          throw new Error(`Cannot create field in element ${part}`);
        }
        target = target[part] as Record<string, unknown>;
      }
      target[parts.at(-1)!] = structuredClone(value);
    }
    return { acknowledged: true };
  });
  return { doc, db: { collection: vi.fn(() => ({ updateOne })) } as never };
}

const BOND_RESULT: BondTurnResult = {
  bondsProcessed: 7,
  couponsPaid: 5,
  bondsMatured: 1,
  bondsDefaulted: 0,
  totalCouponsPaid: 1234.5,
  bondHistorySnapshots: 7,
  bondsAutoRestructured: 0,
  bondsAutoRefinanced: 0,
  sovereignCashProceedsByCountry: { US: 1_000_000 },
  sovereignDebtFaceIssuedByCountry: { US: 1_010_000 },
  sovereignCouponPaidByCountry: { US: 4_200.25 },
  sovereignMaturityCashPaidByCountry: { US: 50_000 },
  sovereignDebtFaceRetiredByCountry: { US: 50_000 },
};

/** The bond to V2 treasury segment of the resourceAndFinanceStart adapter. */
async function runBondAndTreasury(
  runtime: ReturnType<typeof createTurnPhaseRuntime>,
  bondWrite: () => Promise<BondTurnResult>,
  settle: (flows: BondTurnResult) => Promise<unknown>
) {
  const bondTurnResult = await runtime.runPhase("bondTurn", bondWrite);
  const bondFlows = runtime.requirePhaseResult("bondTurn", bondTurnResult, "resetTreasuryCash");
  return runtime.runPhase("resetTreasuryCash", () => settle(bondFlows));
}

function resumedRuntime(doc: Record<string, unknown>, db: never) {
  const phaseState = readCrashedTurnPhaseState(
    doc.processingPhaseStatuses as TurnPhaseTelemetryMap,
    doc.processingPhaseResults
  );
  // Lock acquisition, then the turn's first status write, as in processTurn.
  doc.processingPhaseResults = {};
  doc.processingPhaseStatuses = {};
  return createTurnPhaseRuntime({
    db,
    phaseStatuses: {},
    warnings: [],
    currentPhaseRef: { current: null },
    alreadyApplied: new Set([...phaseState.completed, ...phaseState.interrupted]),
    resumed: phaseState,
  });
}

describe("crash resume of result-carrying phases (#3429)", () => {
  it("restores the exact bond flows, never reruns bondTurn, and settles the treasury once", async () => {
    const { doc, db } = createGameStateDb();
    const bondWrite = vi.fn(async () => BOND_RESULT);
    const settle = vi.fn(async () => ({ countries: 1 }));

    // First holder: bondTurn completes and persists, then the process dies
    // before resetTreasuryCash runs.
    const first = createTurnPhaseRuntime({
      db,
      phaseStatuses: {},
      warnings: [],
      currentPhaseRef: { current: null },
    });
    await expect(first.runPhase("bondTurn", bondWrite)).resolves.toEqual(BOND_RESULT);
    expect(doc.processingPhaseStatuses).toMatchObject({ bondTurn: { status: "completed" } });
    expect(doc.processingPhaseResults).toEqual({ bondTurn: BOND_RESULT });

    const second = resumedRuntime(doc, db);
    await runBondAndTreasury(second, bondWrite, settle);

    expect(bondWrite).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith(BOND_RESULT);
    expect(second.resumeResultOutcome("bondTurn")).toBe("restored");
  });

  it("keeps the restored result and the applied marker through a second crash", async () => {
    const { doc, db } = createGameStateDb();
    const bondWrite = vi.fn(async () => BOND_RESULT);
    await createTurnPhaseRuntime({
      db,
      phaseStatuses: {},
      warnings: [],
      currentPhaseRef: { current: null },
    }).runPhase("bondTurn", bondWrite);

    // Second holder skips bondTurn, then dies before settlement.
    await resumedRuntime(doc, db).runPhase("bondTurn", bondWrite);
    expect(doc.processingPhaseStatuses).toMatchObject({
      bondTurn: { status: "skipped", resumeCarried: "completed" },
    });

    const settle = vi.fn(async () => ({ countries: 1 }));
    await runBondAndTreasury(resumedRuntime(doc, db), bondWrite, settle);
    expect(bondWrite).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledExactlyOnceWith(BOND_RESULT);
  });

  it.each([
    ["legacy completion without a stored result", undefined],
    ["a partial stored result", { bondsProcessed: 7 }],
    ["a non-finite flow", { ...BOND_RESULT, sovereignCouponPaidByCountry: { US: "4200" } }],
  ])("fails closed on %s without rerunning or assuming zero flows", async (_label, stored) => {
    const { doc, db } = createGameStateDb();
    doc.processingPhaseStatuses = { bondTurn: { status: "completed" } };
    doc.processingPhaseResults = stored === undefined ? null : { bondTurn: stored };
    const bondWrite = vi.fn(async () => BOND_RESULT);
    const settle = vi.fn(async () => ({ countries: 1 }));

    const runtime = resumedRuntime(doc, db);
    const run = runBondAndTreasury(runtime, bondWrite, settle);
    await expect(run).rejects.toBeInstanceOf(TurnResumeResultUnavailableError);
    await expect(run).rejects.toThrow(/completed before the crash but no valid stored result/);
    expect(runtime.resumeResultOutcome("bondTurn")).toBe("missing");
    expect(bondWrite).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it("fails closed when bondTurn was interrupted, even if a stale result is stored", async () => {
    const { doc, db } = createGameStateDb();
    doc.processingPhaseStatuses = { bondTurn: { status: "running" } };
    doc.processingPhaseResults = { bondTurn: BOND_RESULT };
    const bondWrite = vi.fn(async () => BOND_RESULT);
    const settle = vi.fn(async () => ({ countries: 1 }));

    const runtime = resumedRuntime(doc, db);
    await expect(runBondAndTreasury(runtime, bondWrite, settle)).rejects.toThrow(
      /bondTurn was interrupted mid-phase/
    );
    expect(runtime.resumeResultOutcome("bondTurn")).toBe("interrupted");
    expect(bondWrite).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it("separates completed from interrupted phases and carries a resumed skip's state", () => {
    const state = readCrashedTurnPhaseState(
      {
        a: { status: "completed" },
        b: { status: "running" },
        c: { status: "skipped", resumeCarried: "completed" },
        d: { status: "skipped", resumeCarried: "interrupted" },
        e: { status: "skipped", reason: "conditional" },
        f: { status: "pending" },
      } as unknown as TurnPhaseTelemetryMap,
      { a: { unrelated: true } }
    );
    expect([...state.completed].sort()).toEqual(["a", "c"]);
    expect([...state.interrupted].sort()).toEqual(["b", "d"]);
    // Only listed phases keep results; arbitrary results are never restored.
    expect(state.results).toEqual({});
  });

  it("flushes bondTurn's running marker before its writes, inside the status throttle window", async () => {
    const { doc, db } = createGameStateDb();
    const runtime = createTurnPhaseRuntime({
      db,
      phaseStatuses: {},
      warnings: [],
      currentPhaseRef: { current: null },
    });
    await runtime.runPhase("commodityPrices", async () => 1);
    const seen: unknown[] = [];
    await runtime.runPhase("bondTurn", async () => {
      seen.push(structuredClone(doc.processingPhaseStatuses));
      return BOND_RESULT;
    });
    expect(seen[0]).toMatchObject({ bondTurn: { status: "running" } });
    expect(doc.processingPhaseStatuses).toMatchObject({ bondTurn: { status: "completed" } });
  });

  it("does not store a result for phases outside the resume list", async () => {
    const { doc, db } = createGameStateDb();
    await createTurnPhaseRuntime({
      db,
      phaseStatuses: {},
      warnings: [],
      currentPhaseRef: { current: null },
    }).runPhase("corporationTurn", async () => ({ huge: "x".repeat(10_000) }));
    expect(doc.processingPhaseResults).toEqual({});
  });

  it("treats the legacy skipped/upstreamAbort marker as interrupted and never reruns it", async () => {
    const { doc, db } = createGameStateDb();
    // Exactly the marker an older release left on the affected world.
    doc.processingPhaseStatuses = {
      bondTurn: {
        status: "skipped",
        reason: "upstreamAbort",
        message: "skipped: already applied before crash",
      },
    };
    doc.processingPhaseResults = null;
    const state = readCrashedTurnPhaseState(
      doc.processingPhaseStatuses as TurnPhaseTelemetryMap,
      null
    );
    expect([...state.interrupted]).toEqual(["bondTurn"]);

    const bondWrite = vi.fn(async () => BOND_RESULT);
    const settle = vi.fn(async () => ({ countries: 1 }));
    const runtime = resumedRuntime(doc, db);
    await expect(runBondAndTreasury(runtime, bondWrite, settle)).rejects.toThrow(
      /bondTurn was interrupted mid-phase/
    );
    expect(bondWrite).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it("treats a failed phase as interrupted", () => {
    const state = readCrashedTurnPhaseState(
      { bondTurn: { status: "failed" } } as unknown as TurnPhaseTelemetryMap,
      { bondTurn: BOND_RESULT }
    );
    expect([...state.interrupted]).toEqual(["bondTurn"]);
    expect(state.results).toEqual({});
  });

  it("stops the turn when the completion result cannot be stored, and never records completed without it", async () => {
    const { doc, db } = createGameStateDb((set) => "processingPhaseResults.bondTurn" in set);
    const phaseStatuses: TurnPhaseTelemetryMap = {};
    const warnings: string[] = [];
    const runtime = createTurnPhaseRuntime({
      db,
      phaseStatuses,
      warnings,
      currentPhaseRef: { current: null },
    });
    const run = runtime.runPhase("bondTurn", async () => BOND_RESULT);
    await expect(run).rejects.toBeInstanceOf(TurnPhaseCompletionPersistError);
    await expect(run).rejects.toSatisfy(isResumeFailClosedError);
    // Neither memory (which the failure path writes whole) nor gameState says completed.
    expect(phaseStatuses.bondTurn?.status).toBe("running");
    expect(doc.processingPhaseStatuses).toMatchObject({ bondTurn: { status: "running" } });
    expect(doc.processingPhaseResults).toEqual({});
    expect(warnings[0]).toMatch(/completion result could not be stored/);
    // A later resume reads it as interrupted, not completed.
    const state = readCrashedTurnPhaseState(
      doc.processingPhaseStatuses as TurnPhaseTelemetryMap,
      doc.processingPhaseResults
    );
    expect([...state.interrupted]).toEqual(["bondTurn"]);
  });
});

describe("lock takeover and setup preserve crash evidence (#3429)", () => {
  function crashedWorld() {
    const { doc, db } = createGameStateDb();
    Object.assign(doc, {
      currentTurn: 11,
      processingKind: "turn",
      processingTargetTurn: 12,
      processingPhase: "resetTreasuryCash",
    });
    return { doc, db };
  }

  /** processTurn's takeover: lock $set only, then validation on the locked doc. */
  function takeOver(doc: Record<string, unknown>, preLockTarget: number | null) {
    Object.assign(doc, lockAcquisitionSet(new Date()));
    return validateLockedResume(doc as never, preLockTarget);
  }

  /** processTurn's first status write after setup. */
  function setupWrite(doc: Record<string, unknown>, resume: ReturnType<typeof takeOver>) {
    const record = bootstrapPhaseRecord({}, resume, new Date());
    Object.assign(doc, {
      processingTargetTurn: 12,
      processingPhaseStatuses: structuredClone(record.statuses),
      processingPhaseResults: structuredClone(record.results),
    });
    return record;
  }

  it("survives a second crash during takeover and setup, then settles once from the stored flows", async () => {
    const { doc, db } = crashedWorld();
    const bondWrite = vi.fn(async () => BOND_RESULT);
    await createTurnPhaseRuntime({
      db,
      phaseStatuses: {},
      warnings: [],
      currentPhaseRef: { current: null },
    }).runPhase("bondTurn", bondWrite);
    doc.processingPhase = "resetTreasuryCash";

    // Holder 2 takes the lock and dies before setup writes anything.
    expect(takeOver(doc, 12)).not.toBeNull();
    // Holder 3 takes over, writes setup, and dies before reaching bondTurn.
    setupWrite(doc, takeOver(doc, 12));
    expect(doc.processingPhase).toBe("resetTreasuryCash");
    expect(doc.processingPhaseResults).toEqual({ bondTurn: BOND_RESULT });
    expect(doc.processingPhaseStatuses).toMatchObject({
      bondTurn: { status: "skipped", resumeCarried: "completed" },
    });

    // Holder 4 completes the turn.
    const resume = takeOver(doc, 12)!;
    const record = setupWrite(doc, resume);
    const settle = vi.fn(async () => ({ countries: 1 }));
    const runtime = createTurnPhaseRuntime({
      db,
      phaseStatuses: record.statuses,
      warnings: [],
      currentPhaseRef: { current: null },
      alreadyApplied: resume.appliedPhases,
      resumed: resume.phaseState,
    });
    await runBondAndTreasury(runtime, bondWrite, settle);
    expect(bondWrite).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledExactlyOnceWith(BOND_RESULT);
  });

  it("reads phase state from the locked document, not a stale pre-lock target", () => {
    const { doc } = crashedWorld();
    doc.processingPhaseStatuses = { bondTurn: { status: "completed" } };
    // The turn advanced between the pre-lock read and the lock.
    doc.currentTurn = 12;
    expect(takeOver(doc, 12)).toBeNull();
    expect(staleRecoveryEvidenceReset(doc as never)).toMatchObject({
      processingTargetTurn: null,
      processingPhaseStatuses: null,
      processingPhaseResults: null,
    });
    // A pre-lock read that named a different target never resumes either.
    const other = crashedWorld().doc;
    expect(takeOver(other, 13)).toBeNull();
  });

  it("does not resume or clear anything for a world released cleanly", () => {
    const doc = {
      currentTurn: 11,
      processingTargetTurn: null,
      processingPhase: null,
      processingPhaseStatuses: null,
      processingPhaseResults: null,
    };
    expect(validateLockedResume(doc as never, null)).toBeNull();
    expect(staleRecoveryEvidenceReset(doc as never)).toBeNull();
  });

  it("never touches crash evidence in the lock acquisition write", () => {
    expect(Object.keys(lockAcquisitionSet(new Date())).sort()).toEqual([
      "isProcessing",
      "processingAbandonedAt",
      "processingHeartbeatAt",
      "processingKind",
      "processingStartedAt",
    ]);
  });
});
