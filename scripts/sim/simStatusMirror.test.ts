import { describe, expect, it } from "vitest";
import { buildStatusMirrorUpdate, completedTurnProgress } from "./simStatusMirror";

describe("buildStatusMirrorUpdate", () => {
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
      { message: "Turn 12 processed successfully", warnings: ["turn 12 warning"] },
      turn12At
    );
    const turn12 = buildStatusMirrorUpdate(job, sandboxTurn12, firstHeartbeat);
    expect(turn12).toMatchObject({
      currentTurn: 12,
      lastMessage: "Turn 12 processed successfully",
      lastWarnings: ["turn 12 warning"],
      progressUpdatedAt: turn12At,
      updatedAt: turn12At,
      workerHeartbeatAt: firstHeartbeat,
    });

    const sandboxTurn13 = completedTurnProgress(
      13,
      { message: "Turn 13 processed successfully", warnings: [] },
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
      progressUpdatedAt: turn13At,
      updatedAt: turn13At,
    });
  });
});
