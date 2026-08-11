import { describe, it, expect } from "vitest";
import { applyPresetToModifiers } from "./applyPresetToModifiers";
import { aggregateYesShare, type ReferendumCohort, type CohortModifier } from "./cohortEngine";
import { findGroundGamePreset } from "@/lib/constants/groundGamePresets";

const base: ReferendumCohort[] = [
  { groupId: "yes_lean", share: 0.5, turnout: 60, yesLean: 60 },
  { groupId: "no_lean", share: 0.5, turnout: 60, yesLean: 40 },
];
const broadcast = findGroundGamePreset("broadcast_ads")!; // persuade, leanSwing 1.5
const rally = findGroundGamePreset("mass_rally")!; // mobilize, turnoutPush 16
const ys = (m: CohortModifier[]) => aggregateYesShare(base, m, 0);

describe("applyPresetToModifiers (raw accumulate)", () => {
  it("whole persuade moves the aggregate by ~leanSwing", () => {
    const m = applyPresetToModifiers(base, [], broadcast, "yes", "whole");
    expect(ys(m) - ys([])).toBeCloseTo(1.5, 1);
  });
  it("contested whole persuade cancels exactly (raw sums to 0)", () => {
    let m = applyPresetToModifiers(base, [], broadcast, "yes", "whole");
    m = applyPresetToModifiers(base, m, broadcast, "no", "whole");
    expect(ys(m)).toBeCloseTo(ys([]), 6);
  });
  it("mobilize is side-meaningful: Yes raises, No lowers", () => {
    const open = ys([]);
    const up = ys(applyPresetToModifiers(base, [], rally, "yes", "whole"));
    const down = ys(applyPresetToModifiers(base, [], rally, "no", "whole"));
    expect(up).toBeGreaterThan(open);
    expect(down).toBeLessThan(open);
  });
  it("repeated targeted persuade tapers (marginal strictly decreasing)", () => {
    const t = { groupId: "yes_lean" } as const;
    let m = applyPresetToModifiers(base, [], broadcast, "yes", t);
    const d1 = ys(m) - ys([]);
    const prev = ys(m);
    m = applyPresetToModifiers(base, m, broadcast, "yes", t);
    const d2 = ys(m) - prev;
    expect(d2).toBeLessThan(d1);
    expect(d2).toBeGreaterThan(0);
  });
  it("whole skips 0-share cohorts", () => {
    const withZero: ReferendumCohort[] = [
      ...base,
      { groupId: "ghost", share: 0, turnout: 50, yesLean: 50 },
    ];
    const m = applyPresetToModifiers(withZero, [], broadcast, "yes", "whole");
    expect(m.find((x) => x.groupId === "ghost")).toBeUndefined();
  });
});
