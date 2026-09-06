import { describe, expect, it } from "vitest";
import { validateCatalog } from "../validate";
import { US_LAWS } from "./usLaws";

describe("US catalog", () => {
  it("passes the full catalog validator", () => {
    expect(validateCatalog(US_LAWS, "US")).toEqual([]);
  });

  it("carries exactly 63 primaries + 6 tax + 41 secondaries", () => {
    expect(US_LAWS.length).toBe(110);
    expect(US_LAWS.filter((l) => l.kind === "primary").length).toBe(63);
    expect(US_LAWS.filter((l) => l.kind === "tax").length).toBe(6);
    expect(US_LAWS.filter((l) => l.kind === "secondary").length).toBe(41);
  });

  it("spot-check: worker-security primary matches the document", () => {
    const law = US_LAWS.find((l) => l.id === "us.economy.workerSecurity.primary")!;
    expect(law.title).toBe("Fair Labor Standards and Employment Security Act");
    expect(law.baselineLevel).toBe(1);
    expect(law.allowedScope).toBe("both");
    expect(law.levels![1].gdpCostFraction).toBeCloseTo(0.00025, 10);
    expect(law.levels![0].gdpCostFraction).toBeUndefined();
  });

  it("spot-check: income-tax slider matches the document", () => {
    const law = US_LAWS.find((l) => l.id === "us.tax.incomeTax")!;
    expect(law.taxPolicy).toMatchObject({
      taxType: "incomeTax",
      minRate: 0,
      maxRate: 60,
      step: 1,
      baselineRate: 35,
    });
    expect(law.taxPolicy!.waypoints.length).toBeGreaterThanOrEqual(5);
  });

  it("spot-check: first secondary leads with highways at 0.5", () => {
    const law = US_LAWS.find((l) => l.id === "us.sec.nationalHighwaysFreight")!;
    expect(law.targets[0]).toEqual({ metricId: "infrastructure.highways", weight: 0.5 });
    expect(law.category).toBe("infrastructure");
    expect(law.baselineLevel).toBe(1);
  });
});

describe("intelligence funding law", () => {
  const law = US_LAWS.find((l) => l.id === "us.sec.intelligenceAuthorization")!;

  it("is seeded unfunded, so shipping it changes no economy", () => {
    expect(law).toBeDefined();
    expect(law.baselineLevel).toBe(0);
    expect(law.budgetKeyOverride).toBe("intelligence");
    expect(law.allowedScope).toBe("national");
  });

  it("carries no cost terms at level 0", () => {
    // The seed writes a statePolicies row for every law but skips the enactedLaws
    // insert at level 0, so a level-0 law contributes no spending line at all.
    expect(law.levels![0].gdpCostFraction).toBeUndefined();
    expect(law.levels![0].incomeCostFraction).toBeUndefined();
    expect(law.levels![0].gdpRevenueFraction).toBeUndefined();
  });

  it("climbs monotonically to half a percent of GDP", () => {
    const fractions = law.levels!.slice(1).map((l) => l.gdpCostFraction!);
    expect(fractions).toEqual([0.0005, 0.0015, 0.003, 0.005]);
  });
});
