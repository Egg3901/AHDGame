import { describe, it, expect } from "vitest";
import {
  shouldRecoverCrashedTurn,
  type CrashRecoverySnapshot,
  getProcessingLockState,
  turnHasCommittedWrites,
  TURN_BOOTSTRAP_PHASE,
} from "./processingLock";

const NOW = new Date("2026-07-07T12:00:00.000Z");
const STALE = new Date(NOW.getTime() - 25 * 60 * 1000); // > 20-min stale cutoff
const FRESH = new Date(NOW.getTime() - 10 * 1000); // within heartbeat window

function snap(overrides: Partial<CrashRecoverySnapshot>): CrashRecoverySnapshot {
  return {
    isProcessing: true,
    processingKind: "turn",
    processingTargetTurn: 926,
    processingPhase: "fundGeneration",
    processingHeartbeatAt: STALE,
    processingStartedAt: STALE,
    updatedAt: STALE,
    currentTurn: 925,
    ...overrides,
  };
}

describe("shouldRecoverCrashedTurn (#2815)", () => {
  it("recovers a stale turn that crashed mid-phase (past bootstrap)", () => {
    expect(shouldRecoverCrashedTurn(snap({}), NOW)).toBe(true);
  });

  it("does NOT recover a healthy in-flight turn (fresh heartbeat) — let it run", () => {
    expect(shouldRecoverCrashedTurn(snap({ processingHeartbeatAt: FRESH }), NOW)).toBe(false);
  });

  it("does NOT recover when no lock is held (clean idle)", () => {
    expect(shouldRecoverCrashedTurn(snap({ isProcessing: false }), NOW)).toBe(false);
  });

  it("does NOT recover a turn stranded at bootstrap — nothing applied, safe to re-run", () => {
    expect(shouldRecoverCrashedTurn(snap({ processingPhase: "turn_bootstrap" }), NOW)).toBe(false);
    expect(shouldRecoverCrashedTurn(snap({ processingPhase: null }), NOW)).toBe(false);
  });

  it("does NOT recover non-turn processing (e.g. forexMigration)", () => {
    expect(shouldRecoverCrashedTurn(snap({ processingKind: "forexMigration" }), NOW)).toBe(false);
  });

  it("does NOT recover when the target turn is not currentTurn+1 (already advanced)", () => {
    // another process completed the crashed turn; target now lags the pointer
    expect(shouldRecoverCrashedTurn(snap({ currentTurn: 926 }), NOW)).toBe(false);
    expect(shouldRecoverCrashedTurn(snap({ processingTargetTurn: null }), NOW)).toBe(false);
  });
});

describe("an abandoned lock", () => {
  const base = {
    isProcessing: true as const,
    processingKind: "turn" as const,
    currentTurn: 672,
    processingTargetTurn: 673,
    processingPhase: "corporationTurn",
    processingStartedAt: new Date("2026-09-06T17:17:53Z"),
    processingHeartbeatAt: new Date("2026-09-06T17:18:57Z"),
    updatedAt: new Date("2026-09-06T17:18:57Z"),
  };
  // One minute after the heartbeat: nowhere near the 20-minute staleness window.
  const justAfter = new Date("2026-09-06T17:19:57Z");

  it("is stale immediately, without serving the staleness wait", () => {
    // The holder announced its own death on the way out. Waiting 20 minutes for a
    // process that is already gone is what makes a redeploy cost a second turn slot.
    const fresh = getProcessingLockState(base, justAfter);
    expect(fresh.isStale).toBe(false);

    const abandoned = getProcessingLockState(
      { ...base, processingAbandonedAt: new Date("2026-09-06T17:19:00Z") },
      justAfter
    );
    expect(abandoned.isStale).toBe(true);
    expect(abandoned.abandoned).toBe(true);
    expect(abandoned.retryAfterMs).toBe(0);
  });

  it("is recovered rather than re-run, because the evidence survived", () => {
    // The whole point of marking instead of releasing. A full release wiped
    // processingPhase, so this returned false and the next cron re-ran a turn that
    // had already paid dividends, pensions and bond coupons.
    expect(
      shouldRecoverCrashedTurn(
        { ...base, processingAbandonedAt: new Date("2026-09-06T17:19:00Z") },
        justAfter
      )
    ).toBe(true);
  });

  it("is still re-run losslessly when nothing had committed", () => {
    // A turn stranded at bootstrap applied nothing, so re-running it is correct and
    // free. The shutdown handler releases that case outright rather than marking it.
    expect(
      shouldRecoverCrashedTurn(
        {
          ...base,
          processingPhase: TURN_BOOTSTRAP_PHASE,
          processingAbandonedAt: new Date("2026-09-06T17:19:00Z"),
        },
        justAfter
      )
    ).toBe(false);
  });

  it("knows which turns have committed writes", () => {
    expect(turnHasCommittedWrites("corporationTurn")).toBe(true);
    expect(turnHasCommittedWrites(TURN_BOOTSTRAP_PHASE)).toBe(false);
    expect(turnHasCommittedWrites(null)).toBe(false);
    expect(turnHasCommittedWrites(undefined)).toBe(false);
  });
});
