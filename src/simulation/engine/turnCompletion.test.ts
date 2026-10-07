import { describe, expect, it } from "vitest";

import type { TurnPhaseTelemetryMap } from "@/lib/db/types/turnPhaseTelemetry";
import { completedTurnStatus } from "./turnCompletion";

const phases = (statuses: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(statuses).map(([phase, entry]) => {
      const [status, reason = null] = entry.split(":");
      return [phase, { status, reason }];
    })
  ) as unknown as TurnPhaseTelemetryMap;

describe("completedTurnStatus", () => {
  it("keeps advisory warnings without reporting a committed turn as failed", () => {
    expect(completedTurnStatus(["corporationTurn: clearing invariant breach"])).toEqual({
      success: true,
      outcome: "clean",
      failedPhases: [],
      abortedPhases: [],
      warningCount: 1,
    });
  });

  it("reports a warning-free committed turn as clean", () => {
    expect(completedTurnStatus([])).toEqual({
      success: true,
      outcome: "clean",
      failedPhases: [],
      abortedPhases: [],
      warningCount: 0,
    });
  });

  it("marks a committed turn with a failed phase as degraded", () => {
    const status = completedTurnStatus(
      ["resetMetricRefresh: replay differs"],
      phases({
        corporationTurn: "completed",
        resetMetricRefresh: "failed",
        decolonization: "skipped",
      })
    );
    expect(status).toEqual({
      success: true,
      outcome: "degraded",
      failedPhases: ["resetMetricRefresh"],
      abortedPhases: [],
      warningCount: 1,
    });
  });

  it("marks phases skipped after an upstream failure as degraded", () => {
    const status = completedTurnStatus(
      [],
      phases({ bondTurn: "failed", treasuryTurn: "skipped:upstreamAbort" })
    );
    expect(status.outcome).toBe("degraded");
    expect(status.abortedPhases).toEqual(["treasuryTurn"]);
  });

  it("treats conditionally skipped phases as clean", () => {
    expect(
      completedTurnStatus(
        [],
        phases({ corporationTurn: "completed", decolonization: "skipped:conditional" })
      ).outcome
    ).toBe("clean");
  });
});
