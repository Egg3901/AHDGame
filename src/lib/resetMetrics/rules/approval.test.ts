import {
  computeStateApprovalBase,
  computeNationalAveragesFromMetrics,
} from "@/lib/utils/governmentApproval";
import type { StateMetrics } from "@/lib/db/types";
import { describe, expect, it } from "vitest";
import {
  evaluateResetApprovalModifiers,
  resetApprovalBaseMetrics,
  resetApprovalDirections,
} from "./approval";
import { buildOpeningMetricSnapshots1991 } from "../seedOpening1991";
import { applyModifiers } from "@/lib/utils/approvalModifiers";
const context = { countryId: "UK", preset: "1991-default", year: 1991 };
const boards = buildOpeningMetricSnapshots1991("approval-test", 1);
const observations = {
  ...boards.find((board) => board._id === "UK:SCO")!.observations,
  ...boards.find((board) => board._id === "UK:national")!.observations,
};
function changed(values: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(observations).map(([id, observation]) => [
      id,
      { ...observation, value: values[id] ?? observation.value },
    ])
  );
}
function ids(values: Record<string, number>) {
  return evaluateResetApprovalModifiers(changed(values), context).map((modifier) => modifier.id);
}
describe("Metrics v2 approval conditions", () => {
  it("restores named effects from real owner observations", () => {
    expect(evaluateResetApprovalModifiers(observations, context).length).toBeGreaterThan(0);
  });
  it("honors air-quality polarity and coverage units", () => {
    const good = ids({ "16": 99, "17": 90, "35": 100, "37": 80 });
    expect(good).toContain("universal_healthcare");
    expect(good).toContain("clean_environment");
    expect(good).not.toContain("poor_air_quality");
    const bad = ids({ "16": 70, "17": 40, "35": 0 });
    expect(bad).toContain("weak_healthcare_capacity");
    expect(bad).toContain("poor_air_quality");
    expect(bad).not.toContain("universal_healthcare");
  });
  it("uses housing and research indexes without treating 100 as a crisis or an R&D percentage", () => {
    expect(ids({ "24": 100, "15": 100 })).not.toContain("housing_stress");
    expect(ids({ "24": 100, "15": 100 })).not.toContain("research_hub");
    expect(ids({ "24": 80, "15": 120 })).toContain("affordable_housing");
    expect(ids({ "24": 80, "15": 120 })).toContain("research_hub");
    expect(ids({ "24": 130 })).toContain("housing_stress");
  });
  it("does not revive retired observations or count polarity aliases twice in the base", () => {
    const base = resetApprovalBaseMetrics(observations);
    expect(base.healthcare.coverageRate).toBeUndefined();
    expect(base.healthcare.uninsuredRate).toBeDefined();
    expect(base.healthcare.treatmentWait).toBeUndefined();
    expect(base.healthcare.nhsWaitingTime).toBeDefined();
    expect(base.economic.costOfLiving).toBeUndefined();
    expect(base.education.literacyRate).toBeUndefined();
    expect(base.population).toBeUndefined();
  });
  it("scores new v2 crime observations with their catalog polarity", () => {
    const reference = resetApprovalBaseMetrics(observations) as unknown as StateMetrics;
    const averages = computeNationalAveragesFromMetrics([reference]);
    const worse = structuredClone(reference);
    const safety = worse.publicSafety as unknown as Record<string, { value: number }>;
    safety.nonviolentCrimeRate = { value: safety.nonviolentCrimeRate.value * 2 };
    const score = (metrics: StateMetrics) =>
      computeStateApprovalBase(
        metrics,
        averages,
        undefined,
        context.preset,
        context.year,
        resetApprovalDirections
      );
    expect(score(worse)).toBeLessThan(score(reference));
  });
  it("makes worsening crime reduce approval with the same positive cap", () => {
    const good = evaluateResetApprovalModifiers(changed({ "31": 0 }), context);
    const bad = evaluateResetApprovalModifiers(changed({ "31": 1000 }), context);
    expect(applyModifiers(50, good)).toBeGreaterThan(applyModifiers(50, bad));
  });
});
