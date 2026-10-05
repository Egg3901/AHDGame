import { describe, expect, it } from "vitest";
import { scoreResetGovernanceStyle } from "./governanceStyle";

describe("scoreResetGovernanceStyle", () => {
  it("scores political direction from current v2 law positions", () => {
    expect(
      scoreResetGovernanceStyle({
        conditionScores: {},
        legislativePositions: ["center_left", "center", "center_right"],
      }).leftRight
    ).toEqual({ value: 50, label: "Centre" });

    expect(
      scoreResetGovernanceStyle({
        conditionScores: {},
        legislativePositions: ["far_left", "center_left"],
      }).leftRight.value
    ).toBe(12.5);
  });

  it("scores democratic health from favorable v2 conditions", () => {
    const score = scoreResetGovernanceStyle({
      conditionScores: {
        "43": 70,
        "44": 70,
        "47": 70,
        "48": 70,
        "49": 70,
        "50": 70,
        "51": 70,
        "52": 70,
        "53": 70,
      },
      legislativePositions: ["center"],
    });

    expect(score.democraticHealth).toEqual({ value: 70, label: "Functioning democracy" });
  });

  it("applies balance-of-power pressure only to democratic health", () => {
    const score = scoreResetGovernanceStyle({
      conditionScores: { "50": 80 },
      legislativePositions: ["center_right"],
      competition: {
        dominantPartyId: "party-a",
        chambersMeasured: 1,
        dominantSeatShare: 75,
        executivePartyId: null,
        executiveSystem: "presidential",
        uninterruptedControlTurns: 0,
        executiveAlignedWithLegislature: null,
        consecutiveExecutiveTerms: 0,
        courtDominantBloc: null,
        courtDominantShare: 0,
        courtSeated: 0,
        courtLiberalSeats: 0,
        courtSwingSeats: 0,
        courtConservativeSeats: 0,
        courtUnclassifiedSeats: 0,
        seatMarginPenalty: 5,
        legislativeContinuityPenalty: 0,
        executiveContinuityPenalty: 0,
        courtPenalty: 0,
        penalty: 5,
      },
    });

    expect(score.leftRight.value).toBe(75);
    expect(score.democraticHealth.value).toBe(75);
  });
});
