import { describe, expect, it } from "vitest";
import { buildCrisisHorizonReport } from "./crisisHorizonReport";

describe("crisis horizon report qualification", () => {
  it("requires the long report interval to span both game years", () => {
    const report = buildCrisisHorizonReport(
      {
        runId: "run",
        seed: "seed",
        status: "completed",
        source: { executedCommit: "a".repeat(40) },
        crisisHorizonTelemetry: {
          expectedFirstTurn: 1,
          expectedLastTurn: 1700,
          families: 7,
        },
      },
      []
    );

    expect(report.qualification).toBe("incomplete");
    expect(report.reasons).toContain("long horizon does not include both 1991 and 2027 game years");
  });
});
