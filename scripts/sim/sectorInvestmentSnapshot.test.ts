import { describe, expect, it } from "vitest";
import { assertInvestmentTurnComplete } from "./sectorInvestmentSnapshot";

describe("balance replay validity", () => {
  it("accepts completed phases and intentionally skipped features", () => {
    expect(() =>
      assertInvestmentTurnComplete(705, 705, {
        turn: 705,
        phaseStatuses: {
          corporationTurn: { status: "completed" },
          disabledFeature: { status: "skipped" },
        },
      })
    ).not.toThrow();
  });
  it("rejects a phase failure even when the engine advanced its clock and cleared live telemetry", () => {
    expect(() =>
      assertInvestmentTurnComplete(705, 705, {
        turn: 705,
        phaseStatuses: {
          corporationTurn: { status: "failed" },
          laterPhase: { status: "completed" },
        },
      })
    ).toThrow(/corporationTurn/);
  });
  it("rejects a crashed, incomplete or unrecorded turn", () => {
    for (const status of ["pending", "running", "notReached"]) {
      expect(() =>
        assertInvestmentTurnComplete(705, 705, {
          turn: 705,
          phaseStatuses: {
            corporationTurn: { status },
          },
        })
      ).toThrow();
    }
    expect(() => assertInvestmentTurnComplete(705, 704, null)).toThrow();
    expect(() => assertInvestmentTurnComplete(705, 705, { turn: 705 })).toThrow();
  });
});
