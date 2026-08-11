import { describe, it, expect } from "vitest";
import { referendumYesShare } from "./resolveYesShare";

const baseline = [
  { groupId: "a", share: 0.5, turnout: 60, yesLean: 70 },
  { groupId: "b", share: 0.5, turnout: 60, yesLean: 30 },
];

describe("referendumYesShare", () => {
  it("uses the cohort aggregate when a baseline exists (== 50 here)", () => {
    expect(
      referendumYesShare({
        cohortBaseline: baseline,
        cohortModifiers: [],
        campaignSpendUnits: { yes: 0, no: 0 },
        campaignBaseYesShare: 50,
        yesShare: 999,
      })
    ).toBeCloseTo(50, 5);
  });

  it("folds PS spend in as a uniform lean shift", () => {
    const withPs = referendumYesShare({
      cohortBaseline: baseline,
      cohortModifiers: [],
      campaignSpendUnits: { yes: 20, no: 0 },
      campaignBaseYesShare: 50,
      yesShare: 0,
    });
    expect(withPs).toBeGreaterThan(50);
  });

  it("falls back to the legacy scalar derivation with no baseline", () => {
    const v = referendumYesShare({
      cohortBaseline: undefined,
      cohortModifiers: [],
      campaignSpendUnits: { yes: 10, no: 0 },
      campaignBaseYesShare: 50,
      yesShare: 0,
    });
    expect(v).toBeGreaterThan(50);
  });
});
