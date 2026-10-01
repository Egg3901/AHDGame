import { describe, expect, it } from "vitest";
import { buildStatusMirrorUpdate, completedTurnProgress } from "./simStatusMirror";

describe("buildStatusMirrorUpdate", () => {
  const health = {
    severity: "warning",
    warningCount: 1,
    errorCount: 0,
    processingWarningCount: 0,
    processingErrorCount: 0,
    integrityWarningCount: 1,
    integrityErrorCount: 0,
    integrityChecked: true,
    qualification: "passing",
  } as const;

  it("retains the last checked health on an unchecked turn", () => {
    const checkedHealth = {
      severity: "error" as const,
      warningCount: 0,
      errorCount: 1,
      processingWarningCount: 0,
      processingErrorCount: 0,
      integrityWarningCount: 0,
      integrityErrorCount: 1,
      integrityChecked: true,
      qualification: "non-passing" as const,
    };
    const checked = completedTurnProgress(
      10,
      { message: "Turn 10", warnings: [], health: checkedHealth },
      new Date("2026-09-20T18:00:10.000Z")
    );
    expect(checked.health).toEqual(checkedHealth);
    const unchecked = completedTurnProgress(
      11,
      { message: "Turn 11", warnings: [], health: null },
      new Date("2026-09-20T18:00:11.000Z")
    );
    expect(unchecked).not.toHaveProperty("health");
    const mirror = buildStatusMirrorUpdate(
      { ...checked, currentTurn: 10 },
      { ...unchecked, currentTurn: 11 },
      new Date("2026-09-20T18:00:12.000Z")
    );
    expect(mirror).not.toHaveProperty("health");
  });

  it("keeps worker liveness separate when sandbox progress has not changed", () => {
    const now = new Date("2026-09-20T18:00:20.000Z");
    expect(
      buildStatusMirrorUpdate(
        {
          currentTurn: 11,
          lastMessage: "Turn 11 processed successfully",
          lastWarnings: [],
          progressUpdatedAt: new Date("2026-09-20T18:00:00.000Z"),
        },
        {
          currentTurn: 11,
          lastMessage: "Turn 11 processed successfully",
          lastWarnings: [],
          updatedAt: new Date("2026-09-20T18:00:00.000Z"),
        },
        now
      )
    ).toEqual({
      workerHeartbeatAt: now,
      heartbeatAt: now,
      workerPhase: "turns",
    });
  });

  it("publishes each non-checkpoint completed turn with its own progress time", () => {
    const firstHeartbeat = new Date("2026-09-20T18:00:20.000Z");
    const turn12At = new Date("2026-09-20T18:00:12.000Z");
    const turn13At = new Date("2026-09-20T18:00:18.000Z");
    const job = {
      currentTurn: 11,
      lastMessage: "Turn 11 processed successfully",
      lastWarnings: [],
      progressUpdatedAt: new Date("2026-09-20T18:00:00.000Z"),
    };

    const sandboxTurn12 = completedTurnProgress(
      12,
      {
        message: "Turn 12 processed successfully",
        warnings: ["turn 12 warning"],
        health,
      },
      turn12At
    );
    const turn12 = buildStatusMirrorUpdate(job, sandboxTurn12, firstHeartbeat);
    expect(turn12).toMatchObject({
      currentTurn: 12,
      lastMessage: "Turn 12 processed successfully",
      lastWarnings: ["turn 12 warning"],
      health,
      progressUpdatedAt: turn12At,
      updatedAt: turn12At,
      workerHeartbeatAt: firstHeartbeat,
    });

    const sandboxTurn13 = completedTurnProgress(
      13,
      { message: "Turn 13 processed successfully", warnings: [], health },
      turn13At
    );
    const turn13 = buildStatusMirrorUpdate(
      { ...job, ...turn12 },
      sandboxTurn13,
      new Date("2026-09-20T18:00:25.000Z")
    );
    expect(turn13).toMatchObject({
      currentTurn: 13,
      lastMessage: "Turn 13 processed successfully",
      lastWarnings: [],
      health,
      progressUpdatedAt: turn13At,
      updatedAt: turn13At,
    });
  });
});
