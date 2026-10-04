import { describe, expect, it } from "vitest";
import { aggregateGameHealth, gameHealthRunSummary, summarizeGameHealth } from "./gameHealth";

describe("game health summary", () => {
  it("keeps commit success separate from integrity severity", () => {
    expect(
      summarizeGameHealth({
        turnSuccess: true,
        processingWarningCount: 0,
        processingErrorCount: 0,
        integrityChecked: true,
        integrityIssues: [{ severity: "error" }, { severity: "warning" }],
      })
    ).toEqual({
      severity: "error",
      warningCount: 1,
      errorCount: 1,
      processingWarningCount: 0,
      processingErrorCount: 0,
      integrityWarningCount: 1,
      integrityErrorCount: 1,
      integrityChecked: true,
      qualification: "non-passing",
    });
  });

  it("marks skipped integrity checks unverified", () => {
    expect(
      summarizeGameHealth({
        turnSuccess: true,
        processingWarningCount: 0,
        processingErrorCount: 0,
        integrityChecked: false,
        integrityIssues: [],
      }).qualification
    ).toBe("unverified");
  });

  it("aggregates legacy snapshots and preserves any non-passing turn", () => {
    const aggregate = aggregateGameHealth([
      gameHealthRunSummary({
        turnProcessing: { success: true, warningCount: 0, errorCount: 0 },
        dataIntegrity: { issues: [{ severity: "error" }] },
      }),
      gameHealthRunSummary({
        turnProcessing: { success: true, warningCount: 1, errorCount: 0 },
        dataIntegrity: { issues: [] },
      }),
    ]);
    expect(aggregate).toMatchObject({
      completedTurns: 2,
      successfulTurns: 2,
      errorCount: 1,
      warningCount: 1,
      severity: "error",
      qualification: "non-passing",
    });
  });

  it("keeps a failed turn at error severity even without a recorded error message", () => {
    const aggregate = aggregateGameHealth([
      gameHealthRunSummary({
        turnProcessing: { success: false, warningCount: 0, errorCount: 0 },
        dataIntegrity: { issues: [] },
      }),
    ]);
    expect(aggregate.severity).toBe("error");
    expect(aggregate.qualification).toBe("non-passing");
  });
});
