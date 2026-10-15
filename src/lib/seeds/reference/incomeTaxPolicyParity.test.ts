import { describe, expect, it } from "vitest";
import { INCOME_TAX_POLICY_JURISDICTIONS } from "@/lib/budget/rules/incomeTaxPolicy";
import { getBasePolicies } from "./basePolicies";
import { getInitialNationalBudgetsForPreset } from "./budgets";
import { legislationTypes } from "./legislationTypes";

describe("Brazil and Nigeria income-tax seed parity", () => {
  it.each(["1953-default", "1979-default", "1991-default", "2019-default"])(
    "keeps policy rates equal to budget rates in %s",
    async (preset) => {
      const policies = await getBasePolicies(preset);
      const budgets = getInitialNationalBudgetsForPreset(preset);
      for (const jurisdiction of INCOME_TAX_POLICY_JURISDICTIONS) {
        const policy = policies.find(
          (entry) =>
            entry.stateId === jurisdiction.stateId &&
            entry.legislationTypeId === jurisdiction.legislationTypeId
        );
        const budget = budgets.find((entry) => entry.countryId === jurisdiction.countryId);
        expect(policy).toBeDefined();
        expect(budget).toBeDefined();
        const rate = policy?.policyOptionId?.startsWith("rate:")
          ? Number(policy.policyOptionId.slice(5))
          : legislationTypes
              .find((type) => type._id === jurisdiction.legislationTypeId)
              ?.policyOptions?.find((option) => option.id === policy?.policyOptionId)?.rate;
        expect(rate).toBe(budget?.taxRates.incomeTax);
      }
    }
  );
  it.each(["1999-default", "2007-default", "2023-default", "2027-default"])(
    "does not invent missing country policy seeds in %s",
    async (preset) => {
      const policies = await getBasePolicies(preset);
      expect(
        policies.some((policy) =>
          INCOME_TAX_POLICY_JURISDICTIONS.some(
            (entry) => entry.legislationTypeId === policy.legislationTypeId
          )
        )
      ).toBe(false);
    }
  );
  it("preserves the existing 1991 fiscal calibration", () => {
    const budgets = getInitialNationalBudgetsForPreset("1991-default");
    expect(budgets.find((budget) => budget.countryId === "BR")?.taxRates.incomeTax).toBe(22);
    expect(budgets.find((budget) => budget.countryId === "NG")?.taxRates.incomeTax).toBe(24);
  });
});
