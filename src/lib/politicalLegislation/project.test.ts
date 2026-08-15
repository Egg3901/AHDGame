import { describe, expect, it } from "vitest";
import { RU_LAWS } from "./laws/ruLaws";
import { UK_LAWS } from "./laws/ukLaws";
import { US_LAWS } from "./laws/usLaws";
import { isNewGenerationType, projectLawToLegislationType } from "./project";

const nhs = UK_LAWS.find((l) => l.id === "uk.health.universalCare.primary")!;

describe("projectLawToLegislationType", () => {
  it("round-trips core fields on a program law", () => {
    const doc = projectLawToLegislationType(nhs);
    expect(doc._id).toBe("uk.health.universalCare.primary");
    expect(doc.name).toBe(nhs.title);
    expect(doc.description).toBe(nhs.description);
    expect(doc.countryScope).toBe("uk");
    expect(doc.allowedScope).toBe("national");
    expect(doc.budgetCategory).toBe("health");
    expect(doc.politicalMetricTargets).toEqual([{ metricId: "health.universalCare", weight: 1 }]);
    expect(doc.policyOptions).toHaveLength(5);
    expect(doc.policyOptions![0].id).toBe("l0");
    expect(doc.policyOptions![4].id).toBe("l4");
    expect(doc.policyOptions![4].name).toBe(nhs.levels![4].name);
    expect(doc.policyOptions![4].costModelV2).toEqual({ incomeCostFraction: 0.0308 });
    expect(doc.policyOptions![0].costModelV2).toEqual({});
  });

  it("derives the NHS axes fixture: economic +5 → −5 across levels 0→4", () => {
    // health→economic axis; universalCare lean −5; level 0 = lean-opposed pole.
    const doc = projectLawToLegislationType(nhs);
    expect(doc.policyOptions!.map((o) => o.economic)).toEqual([5, 2.5, 0, -2.5, -5]);
    expect(doc.policyOptions!.map((o) => o.social)).toEqual([0, 0, 0, 0, 0]);
    expect(doc.policyOptions!.map((o) => o.stance)).toEqual([
      "right",
      "right",
      "center",
      "left",
      "left",
    ]);
    expect(doc.policyOptions!.map((o) => o.effectDirection)).toEqual([-1, -1, 0, 1, 1]);
  });

  it("puts social-axis categories on the social axis", () => {
    const law = US_LAWS.find((l) => l.id === "us.defense.armedForces.primary")!;
    const doc = projectLawToLegislationType(law);
    // defense.armedForces lean +3 (slot 6 of 7): social runs −3 → +3.
    expect(doc.policyOptions!.map((o) => o.social)).toEqual([-3, -1.5, 0, 1.5, 3]);
    expect(doc.policyOptions!.every((o) => o.economic === 0)).toBe(true);
  });

  it("projects a lean-0 primary with zero axes and center stances", () => {
    const law = US_LAWS.find((l) => l.id === "us.economy.stability.primary")!;
    const doc = projectLawToLegislationType(law);
    expect(doc.policyOptions!.every((o) => o.economic === 0 && o.social === 0)).toBe(true);
    expect(doc.policyOptions!.every((o) => o.stance === "center")).toBe(true);
  });

  it("maps regional allowedScope to the pipeline's state value", () => {
    const law = US_LAWS.find((l) => l.allowedScope === "both")!;
    expect(projectLawToLegislationType(law).allowedScope).toBe("both");
    const regional = { ...law, allowedScope: "regional" as const };
    expect(projectLawToLegislationType(regional).allowedScope).toBe("state");
  });

  it("honors per-law budget-key overrides", () => {
    const pensions = UK_LAWS.find((l) => l.id === "uk.health.socialInsurance.primary")!;
    expect(projectLawToLegislationType(pensions).budgetCategory).toBe("statePensions");
  });

  it("projects tax laws as sliders with taxRateChange and no options ladder", () => {
    const turnover = RU_LAWS.find((l) => l.id === "ru.tax.salesTax")!;
    const doc = projectLawToLegislationType(turnover);
    expect(doc.policyOptions).toBeUndefined();
    expect(doc.taxSlider).toMatchObject({ taxType: "salesTax", baselineRate: 31 });
    expect(doc.taxRateChange).toEqual({ scope: "federal", taxType: "salesTax" });
    expect(doc.budgetCategory).toBeUndefined();
    expect(doc.allowedScope).toBe("national");
  });

  it("projects regional tax laws to pipeline allowedScope state", () => {
    const federal = US_LAWS.find((l) => l.id === "us.tax.incomeTax")!;
    expect(projectLawToLegislationType(federal).allowedScope).toBe("national");
    const regional = { ...federal, allowedScope: "regional" as const };
    expect(projectLawToLegislationType(regional).allowedScope).toBe("state");
  });

  it("never emits legacy flat cost fields or old-generation effect fields", () => {
    for (const law of [...US_LAWS, ...UK_LAWS, ...RU_LAWS]) {
      const doc = projectLawToLegislationType(law);
      expect(doc.effectTargetsWeighted).toBeUndefined();
      expect(doc.demographicEffects).toBeUndefined();
      for (const option of doc.policyOptions ?? []) {
        expect(option.metricEffects).toBeUndefined();
        expect(option.gdpCostFraction).toBeUndefined();
        expect(option.incomeCostFraction).toBeUndefined();
        expect(option.gdpPerCapitaMultiplier).toBeUndefined();
        expect(option.annualCostPerCapita).toBeUndefined();
      }
    }
  });

  it("marks every projected doc as new-generation", () => {
    for (const law of [...US_LAWS, ...UK_LAWS, ...RU_LAWS]) {
      expect(isNewGenerationType(projectLawToLegislationType(law))).toBe(true);
    }
  });
});
