import { describe, expect, it } from "vitest";
import {
  INITIAL_TURN_PROGRESS,
  TURN_PROGRESS_STALE_MS,
  measuredProgress,
  processingSessionKey,
  reduceTurnProgress,
  type TurnProgressEvent,
  type TurnProgressSnapshot,
  type TurnProgressStatus,
} from "./turnProgressLifecycle";

const T0 = Date.parse("2026-09-09T12:00:00.000Z");

function sp(overrides: Partial<TurnProgressStatus> = {}): TurnProgressStatus {
  return {
    currentTurn: 40,
    isActive: true,
    isProcessing: true,
    nextScheduledTurn: null,
    singleplayer: true,
    processingTargetTurn: 41,
    processingPhase: "corporationProduction",
    processingPhaseLabel: "Corporation Production",
    processingProgress: 47,
    processingStartedAt: new Date(T0).toISOString(),
    processingHeartbeatAt: new Date(T0 + 5_000).toISOString(),
    ...overrides,
  };
}

function fold(events: TurnProgressEvent[], start: TurnProgressSnapshot = INITIAL_TURN_PROGRESS) {
  return events.reduce(reduceTurnProgress, start);
}

describe("measuredProgress", () => {
  it("returns the server-measured percent and does not invent a floor", () => {
    expect(measuredProgress(sp({ processingProgress: 47 }))).toBe(47);
    expect(measuredProgress(sp({ processingProgress: 0 }))).toBe(0);
    expect(measuredProgress(sp({ processingProgress: null }))).toBeNull();
    expect(measuredProgress(sp({ processingProgress: Number.NaN }))).toBeNull();
  });
});

describe("processingSessionKey", () => {
  it("does not collapse a null target into a permanent dismiss identity", () => {
    expect(processingSessionKey(sp({ processingTargetTurn: null }), 40)).toBe(`start:${T0}`);
    expect(processingSessionKey(sp({ processingTargetTurn: 41 }), 40)).toBe(
      `target:41:start:${T0}`
    );
  });
});

describe("reduceTurnProgress", () => {
  it("hides on multiplayer even while a turn is processing", () => {
    const snap = fold([{ type: "status", status: sp({ singleplayer: false }), nowMs: T0 }]);
    expect(snap.view.kind).toBe("hidden");
  });

  it("shows measured processing for a singleplayer turn", () => {
    const snap = fold([{ type: "status", status: sp(), nowMs: T0 }]);
    expect(snap.view.kind).toBe("processing");
    expect(snap.view.progress).toBe(47);
    expect(snap.view.activityId).toBe("economy");
    expect(snap.view.targetTurn).toBe(41);
  });

  it("clears the popup once current turn has reached the processing target", () => {
    const snap = fold([
      { type: "status", status: sp(), nowMs: T0 },
      {
        type: "status",
        status: sp({ currentTurn: 41, isProcessing: true, processingTargetTurn: 41 }),
        nowMs: T0 + 1_000,
      },
    ]);
    expect(snap.view.kind).toBe("hidden");
  });

  it("clears the popup when processing stops after the turn advances", () => {
    const snap = fold([
      { type: "status", status: sp(), nowMs: T0 },
      {
        type: "status",
        status: sp({
          currentTurn: 41,
          isProcessing: false,
          processingTargetTurn: null,
          processingProgress: null,
        }),
        nowMs: T0 + 2_000,
      },
    ]);
    expect(snap.view.kind).toBe("hidden");
  });

  it("clears on the local completion event and ignores a leftover processing snapshot", () => {
    const snap = fold([
      { type: "status", status: sp(), nowMs: T0 },
      { type: "complete" },
      { type: "status", status: sp(), nowMs: T0 + 500 },
    ]);
    expect(snap.view.kind).toBe("hidden");
  });

  it("shows a restarted attempt of the same target turn after cancellation", () => {
    const cancelled = fold([{ type: "status", status: sp(), nowMs: T0 }, { type: "cancel" }]);
    const restarted = reduceTurnProgress(cancelled, {
      type: "status",
      status: sp({ processingStartedAt: new Date(T0 + 1000).toISOString() }),
      nowMs: T0 + 1000,
    });
    expect(restarted.view.kind).toBe("processing");
  });

  it("stops on cancel and on a processing flag that drops without advancing", () => {
    const cancelled = fold([{ type: "status", status: sp(), nowMs: T0 }, { type: "cancel" }]);
    expect(cancelled.view.kind).toBe("hidden");

    const dropped = fold([
      { type: "status", status: sp(), nowMs: T0 },
      {
        type: "status",
        status: sp({
          isProcessing: false,
          processingTargetTurn: null,
          processingProgress: null,
        }),
        nowMs: T0 + 1_000,
      },
    ]);
    expect(dropped.view.kind).toBe("hidden");
  });

  it("shows an honest error instead of a spinner", () => {
    const snap = fold([
      { type: "status", status: sp(), nowMs: T0 },
      { type: "error", message: "Turn failed" },
    ]);
    expect(snap.view.kind).toBe("error");
    expect(snap.view.errorMessage).toBe("Turn failed");
    expect(snap.view.progress).toBe(47);
  });

  it("shows connection loss when the browser goes offline or the snapshot vanishes", () => {
    const offline = fold([{ type: "status", status: sp(), nowMs: T0 }, { type: "offline" }]);
    expect(offline.view.kind).toBe("offline");

    const lost = fold([
      { type: "status", status: sp(), nowMs: T0 },
      { type: "status", status: null, nowMs: T0 + 1_000 },
    ]);
    expect(lost.view.kind).toBe("offline");
  });

  it("shows stale after the 30 minute bound without declaring the turn complete", () => {
    const snap = fold([
      { type: "status", status: sp(), nowMs: T0 },
      { type: "tick", nowMs: T0 + TURN_PROGRESS_STALE_MS },
    ]);
    expect(snap.view.kind).toBe("stale");
    expect(snap.view.progress).toBe(47);
  });

  it("shows stale when the processing lock is already marked resettable", () => {
    const snap = fold([
      { type: "status", status: sp({ canResetProcessingLock: true }), nowMs: T0 },
    ]);
    expect(snap.view.kind).toBe("stale");
  });

  it("hides a dismissed session and shows again for a later turn", () => {
    const dismissed = fold([{ type: "status", status: sp(), nowMs: T0 }, { type: "dismiss" }]);
    expect(dismissed.view.kind).toBe("hidden");

    const sameTurn = reduceTurnProgress(dismissed, {
      type: "status",
      status: sp({ processingProgress: 60 }),
      nowMs: T0 + 1_000,
    });
    expect(sameTurn.view.kind).toBe("hidden");

    const nextTurn = reduceTurnProgress(sameTurn, {
      type: "status",
      status: sp({
        currentTurn: 41,
        processingTargetTurn: 42,
        processingStartedAt: new Date(T0 + 60_000).toISOString(),
      }),
      nowMs: T0 + 60_000,
    });
    expect(nextTurn.view.kind).toBe("processing");
    expect(nextTurn.view.targetTurn).toBe(42);
  });

  it("treats a null target dismiss as that session only", () => {
    const started = new Date(T0).toISOString();
    const dismissed = fold([
      {
        type: "status",
        status: sp({ processingTargetTurn: null, processingStartedAt: started }),
        nowMs: T0,
      },
      { type: "dismiss" },
    ]);
    expect(dismissed.view.kind).toBe("hidden");

    const next = reduceTurnProgress(dismissed, {
      type: "status",
      status: sp({
        processingTargetTurn: 42,
        currentTurn: 41,
        processingStartedAt: new Date(T0 + 10_000).toISOString(),
      }),
      nowMs: T0 + 10_000,
    });
    expect(next.view.kind).toBe("processing");
  });
});
