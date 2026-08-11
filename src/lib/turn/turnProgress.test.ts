import { describe, expect, it } from "vitest";
import { computeTurnProcessingProgress, formatTurnPhaseLabel } from "./turnProgress";

describe("formatTurnPhaseLabel", () => {
  it("humanizes camelCase phase names", () => {
    expect(formatTurnPhaseLabel("financialSuspectScan")).toBe("financial Suspect Scan");
  });

  it("returns a starting label for empty input", () => {
    expect(formatTurnPhaseLabel(null)).toBe("Starting…");
  });
});

describe("computeTurnProcessingProgress", () => {
  it("returns a small value during bootstrap", () => {
    expect(computeTurnProcessingProgress("turn_bootstrap", {})).toBe(2);
  });

  it("advances with later phases", () => {
    const early = computeTurnProcessingProgress("actionRefresh", {});
    const late = computeTurnProcessingProgress("ledgerReconcile", {});
    expect(late).toBeGreaterThan(early);
    expect(late).toBeLessThanOrEqual(98);
  });

  it("falls back to completed phase counts when the phase is unknown", () => {
    expect(
      computeTurnProcessingProgress("unknownPhase", {
        actionRefresh: {
          status: "completed",
          startedAt: null,
          completedAt: null,
          updatedAt: new Date(),
          reason: null,
          message: null,
        },
        fundGeneration: {
          status: "skipped",
          startedAt: null,
          completedAt: null,
          updatedAt: new Date(),
          reason: "featureDisabled",
          message: null,
        },
      })
    ).toBeGreaterThan(0);
  });
});
