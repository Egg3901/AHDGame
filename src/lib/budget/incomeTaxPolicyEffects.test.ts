import { describe, expect, it } from "vitest";
import { computeTickRates, calculateMetricTarget, type ActivePolicy } from "@/lib/policyEffects";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";

describe("income-tax record repair preserves non-fiscal outcomes", () => {
  it.each([
    { typeId: "br_income_tax_rate", countryId: "BR", rate: 22 },
    { typeId: "ng_personal_income_tax", countryId: "NG", rate: 24 },
  ])(
    "preserves $countryId policy effects when encoding the fiscal rate",
    ({ typeId, countryId, rate }) => {
      const type = legislationTypes.find((entry) => entry._id === typeId)!;
      const original = {
        legislationTypeId: typeId,
        policyOptionId: type.policyOptions![3].id,
        policyOptionIndex: 3,
        effectDirection: type.policyOptions![3].effectDirection,
        scopeMultiplier: 1,
        economic: 0,
        social: 0,
      } as ActivePolicy;
      const repaired = { ...original, policyOptionId: `rate:${rate}` };
      const types = new Map([[typeId, type]]);
      expect(computeTickRates([repaired], types, countryId)).toEqual(
        computeTickRates([original], types, countryId)
      );
      for (const target of type.effectTargetsWeighted ?? []) {
        expect(
          calculateMetricTarget(null, target.metricCategoryId, target.metricId, [repaired], types)
        ).toEqual(
          calculateMetricTarget(null, target.metricCategoryId, target.metricId, [original], types)
        );
      }
    }
  );
});
