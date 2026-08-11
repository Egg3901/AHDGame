import { describe, it, expect } from "vitest";
import { calculateMetricTarget } from "./policyEffects";
import type { ActivePolicy } from "./policyEffects";
import type { LegislationType } from "./db/types";

// workforceSkill is a 0-100 education index metric (rangeScale = 1.0).
const legType = {
  _id: "t_edu",
  name: "Edu",
  effectTargetsWeighted: [{ metricCategoryId: "education", metricId: "workforceSkill", weight: 1 }],
  policyOptions: [
    { id: "max", effectDirection: 1 }, // idx0 intensity +1
    { id: "mod", effectDirection: 1 }, // idx1
    { id: "less", effectDirection: 1 }, // idx2 intensity +1/3
    { id: "center", effectDirection: 0 }, // idx3 intensity 0
    { id: "cut", effectDirection: -1 }, // idx4
  ],
} as unknown as LegislationType;
const legTypeMap = new Map([[legType._id, legType]]);

const policy = (optId: string): ActivePolicy =>
  ({
    stateId: "uk_national",
    legislationTypeId: "t_edu",
    policyOptionId: optId,
    effectDirection: 1,
    scopeMultiplier: 1,
  }) as unknown as ActivePolicy;

describe("calculateMetricTarget — graded intensity", () => {
  it("Maximum pushes the target higher than Moderate (same side)", () => {
    const base = calculateMetricTarget(null, "education", "workforceSkill", [], legTypeMap, 0, 50);
    const max = calculateMetricTarget(
      null,
      "education",
      "workforceSkill",
      [policy("max")],
      legTypeMap,
      0,
      50
    );
    const mod = calculateMetricTarget(
      null,
      "education",
      "workforceSkill",
      [policy("less")],
      legTypeMap,
      0,
      50
    );
    expect(max).toBeGreaterThan(mod);
    expect(mod).toBeGreaterThan(base);
  });
  it("center option is a no-op vs no policy", () => {
    const base = calculateMetricTarget(null, "education", "workforceSkill", [], legTypeMap, 0, 50);
    const center = calculateMetricTarget(
      null,
      "education",
      "workforceSkill",
      [policy("center")],
      legTypeMap,
      0,
      50
    );
    expect(center).toBeCloseTo(base, 6);
  });
});
