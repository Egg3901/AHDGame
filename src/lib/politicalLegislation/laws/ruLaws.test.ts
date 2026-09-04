import { describe, expect, it } from "vitest";
import { validateCatalog } from "../validate";
import { RU_LAWS } from "./ruLaws";
import { UK_LAWS } from "./ukLaws";
import { US_LAWS } from "./usLaws";
import { DD_LAWS } from "./ddLaws";

describe("RU catalog", () => {
  it("passes the full catalog validator", () => {
    expect(validateCatalog(RU_LAWS, "RU")).toEqual([]);
  });

  it("carries exactly 63 primaries + 6 tax + 41 secondaries", () => {
    expect(RU_LAWS.length).toBe(110);
    expect(RU_LAWS.filter((l) => l.kind === "primary").length).toBe(63);
    expect(RU_LAWS.filter((l) => l.kind === "tax").length).toBe(6);
    expect(RU_LAWS.filter((l) => l.kind === "secondary").length).toBe(41);
  });

  it("spot-check: turnover-tax slider is the ₽240B anchor at 31", () => {
    const law = RU_LAWS.find((l) => l.id === "ru.tax.salesTax")!;
    expect(law.title).toBe("Turnover Tax Act");
    expect(law.taxPolicy).toMatchObject({
      taxType: "salesTax",
      minRate: 0,
      maxRate: 45,
      step: 1,
      baselineRate: 31,
    });
  });

  it("spot-check: pensions primary is L1 with statePensions key and a reformTitle", () => {
    const law = RU_LAWS.find((l) => l.id === "ru.health.socialInsurance.primary")!;
    expect(law.baselineLevel).toBe(1);
    expect(law.budgetKeyOverride).toBe("statePensions");
    expect(law.reformTitle).toBe("Universal Pensions Act");
  });

  it("carries exactly the 11 §5c reformTitle laws", () => {
    expect(RU_LAWS.filter((l) => l.reformTitle).length).toBe(11);
  });
});

describe("cross-country topology parity", () => {
  it("secondary target lists are index-identical across US/UK/RU/DD", () => {
    const sec = (laws: typeof US_LAWS) =>
      laws
        .filter((l) => l.kind === "secondary")
        .map((l) => l.targets.map((t) => `${t.metricId}×${t.weight}`).join(","));
    const us = sec(US_LAWS);
    expect(sec(UK_LAWS)).toEqual(us);
    expect(sec(RU_LAWS)).toEqual(us);
    expect(sec(DD_LAWS)).toEqual(us);
  });
});

describe("intelligence funding law", () => {
  const law = RU_LAWS.find((l) => l.id === "ru.sec.stateSecurityOrgans")!;

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
