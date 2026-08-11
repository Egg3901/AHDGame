import { describe, expect, it } from "vitest";
import { finalizeAbortedPhaseStatuses } from "@/simulation/engine/phaseTelemetry";

describe("finalizeAbortedPhaseStatuses", () => {
  it("marks running phases failed and untouched phases notReached", () => {
    const failureTime = new Date("2026-05-02T12:00:00.000Z");
    const result = finalizeAbortedPhaseStatuses(
      {
        actionRefresh: {
          status: "completed",
          startedAt: new Date("2026-05-02T11:59:00.000Z"),
          completedAt: new Date("2026-05-02T11:59:10.000Z"),
          updatedAt: new Date("2026-05-02T11:59:10.000Z"),
          reason: null,
          message: null,
        },
        fundGeneration: {
          status: "running",
          startedAt: new Date("2026-05-02T11:59:10.000Z"),
          completedAt: null,
          updatedAt: new Date("2026-05-02T11:59:11.000Z"),
          reason: null,
          message: null,
        },
      },
      "fundGeneration",
      failureTime,
      "boom"
    );

    expect(result.actionRefresh.status).toBe("completed");
    expect(result.fundGeneration.status).toBe("failed");
    expect(result.fundGeneration.completedAt).toEqual(failureTime);
    expect(result.bondTurn.status).toBe("notReached");
    expect(result.bondTurn.reason).toBe("upstreamAbort");
  });
});
