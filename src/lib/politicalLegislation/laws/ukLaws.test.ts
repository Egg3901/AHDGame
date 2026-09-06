import { describe, expect, it } from "vitest";
import { validateCatalog } from "../validate";
import { UK_LAWS } from "./ukLaws";

describe("UK catalog", () => {
  it("passes the full catalog validator", () => {
    expect(validateCatalog(UK_LAWS, "UK")).toEqual([]);
  });

  it("carries exactly 63 primaries + 6 tax + 41 secondaries", () => {
    expect(UK_LAWS.length).toBe(110);
    expect(UK_LAWS.filter((l) => l.kind === "primary").length).toBe(63);
    expect(UK_LAWS.filter((l) => l.kind === "tax").length).toBe(6);
    expect(UK_LAWS.filter((l) => l.kind === "secondary").length).toBe(41);
  });

  it("spot-check: NHS Act ladder matches the document (the §4.2 worked example)", () => {
    const law = UK_LAWS.find((l) => l.id === "uk.health.universalCare.primary")!;
    expect(law.title).toBe("National Health Service Act");
    expect(law.baselineLevel).toBe(4);
    expect(law.levels!.map((lv) => lv.incomeCostFraction)).toEqual([
      undefined,
      0.009,
      0.0158,
      0.0237,
      0.0308,
    ]);
  });

  it("spot-check: NI slider is [0–20, step 0.2] at 7.2 (audit finding 3 fix)", () => {
    const law = UK_LAWS.find((l) => l.id === "uk.tax.payrollTax")!;
    expect(law.taxPolicy).toMatchObject({
      taxType: "payrollTax",
      minRate: 0,
      maxRate: 20,
      step: 0.2,
      baselineRate: 7.2,
    });
  });

  it("spot-check: pensions primary overrides to statePensions", () => {
    const law = UK_LAWS.find((l) => l.id === "uk.health.socialInsurance.primary")!;
    expect(law.budgetKeyOverride).toBe("statePensions");
  });

  it("spot-check: council-housing primary routes to other", () => {
    const law = UK_LAWS.find((l) => l.id === "uk.infrastructure.publicHousing.primary")!;
    expect(law.budgetKeyOverride).toBe("other");
    expect(law.baselineLevel).toBe(3);
  });
});

describe("intelligence funding law", () => {
  const law = UK_LAWS.find((l) => l.id === "uk.sec.secretVote")!;

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
