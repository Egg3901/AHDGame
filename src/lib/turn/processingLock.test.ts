import { describe, it, expect } from "vitest";
import { shouldRecoverCrashedTurn, type CrashRecoverySnapshot } from "./processingLock";

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
