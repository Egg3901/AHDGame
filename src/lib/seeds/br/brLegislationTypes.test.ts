import { describe, expect, it } from "vitest";
import { brLegislationTypes } from "./brLegislationTypes";
import { calculatePolicyOptionAnnualCost, calculateEnactedLawAnnualCost } from "@/lib/budget/costs";
import {
  generateDefaultEnactedLaws,
  getInitialNationalBudgetsForPreset,
  NATIONAL_BUDGET_SEED_CONFIGS_1953,
} from "@/lib/seeds/reference/budgets";
import { COUNTRY_POLICY_CONFIGS_1953 } from "@/lib/seeds/reference/basePolicies1953";

const brConfig = NATIONAL_BUDGET_SEED_CONFIGS_1953.find((c) => c.countryId === "BR")!;
const brBudget = getInitialNationalBudgetsForPreset("1953-default").find(
  (b) => b.countryId === "BR"
)!;
const brLaws1953 = generateDefaultEnactedLaws("1953-default").filter(
  (l) => l.countryId === "BR" && l.rate === undefined
);

const SIX_CATEGORIES = [
  "socialSecurity",
  "healthcare",
  "education",
  "defense",
  "infrastructure",
  "other",
] as const;

describe("BR legislation module — coverage", () => {
  it("seeds exactly 14 legislation types, all scoped to br", () => {
    expect(brLegislationTypes).toHaveLength(14);
    for (const lt of brLegislationTypes) {
      expect(lt.countryScope, lt._id).toBe("br");
    }
  });

  it("seeds a tax-rate lever for every taxPolicyIds dial BR's 1953 budget config references", () => {
    const ids = new Set(brLegislationTypes.map((lt) => lt._id));
    for (const legislationTypeId of Object.values(brConfig.taxPolicyIds)) {
      if (!legislationTypeId) continue;
      expect(ids.has(legislationTypeId), legislationTypeId).toBe(true);
    }
  });

  it("seeds exactly one budgetCategory-bearing law per authored baseline category, plus one isGrant law", () => {
    const byCategory = brLegislationTypes.filter(
      (lt) =>
        lt.budgetCategory && !lt.isGrant && SIX_CATEGORIES.includes(lt.budgetCategory as never)
    );
    const categoriesCovered = new Set(byCategory.map((lt) => lt.budgetCategory));
    for (const cat of SIX_CATEGORIES) {
      expect(categoriesCovered.has(cat), cat).toBe(true);
    }
    const grantLaws = brLegislationTypes.filter((lt) => lt.isGrant);
    expect(grantLaws).toHaveLength(1);
  });

  it("every br_ id has a policyDefaults + policyOptionOverrides entry in basePolicies1953", () => {
    const defaults = COUNTRY_POLICY_CONFIGS_1953.br.defaults;
    const overrides = COUNTRY_POLICY_CONFIGS_1953.br.optionIndexes;
    for (const lt of brLegislationTypes) {
      expect(defaults[lt._id], `defaults.${lt._id}`).toBeDefined();
      expect(overrides[lt._id], `optionIndexes.${lt._id}`).toBeTypeOf("number");
      const idx = overrides[lt._id];
      expect(lt.policyOptions?.[idx], `${lt._id}[${idx}] out of range`).toBeDefined();
    }
  });
});

describe("BR legislation module — revenue reconciliation (tax rates unchanged from the pre-legislation stopgap)", () => {
  it("BR's seeded federalBudget.taxRates match the old taxRateOverrides stopgap exactly", () => {
    expect(brBudget.taxRates.incomeTax).toBe(18);
    expect(brBudget.taxRates.domesticCorporateTax).toBe(18);
    expect(brBudget.taxRates.foreignCorporateTax).toBe(18); // mirrors domestic (no separate bill)
    expect(brBudget.taxRates.payrollTax).toBe(20);
    expect(brBudget.taxRates.tariffs).toBe(18);
    expect(brBudget.taxRates.salesTax).toBe(10);
  });

  it("BR's day-one revenue is strictly positive and unaffected by the legislation module landing", () => {
    expect(brBudget.revenue.total).toBeGreaterThan(0);
    // Sanity: tariff revenue is no longer silently zero (mirrors the TR fix).
    expect(brBudget.taxRates.tariffs).toBeGreaterThan(0);
    const tariffRevenue = brBudget.taxBases.importValue * (brBudget.taxRates.tariffs / 100);
    expect(tariffRevenue).toBeGreaterThan(0);
  });
});

describe("BR legislation module — spending reconciliation (all six categories + grants)", () => {
  it("BR now has real spending laws (not the empty catalog that forced the baseline fallback)", () => {
    expect(brLaws1953.length).toBeGreaterThan(0);
    const actualCats = new Set(brLaws1953.map((l) => l.budgetCategory));
    for (const key of Object.keys(brConfig.baselineSpendingByCategory)) {
      expect(actualCats.has(key), `BR baselineSpendingByCategory key "${key}"`).toBe(true);
    }
  });

  it("BR's seeded federalBudget.spending.byCategory reconciles to the authored baseline in all six categories", () => {
    for (const cat of SIX_CATEGORIES) {
      const authored = brConfig.baselineSpendingByCategory[cat];
      expect(authored, cat).toBeTypeOf("number");
      expect(brBudget.spending.byCategory[cat], cat).toBe(authored);
    }
  });

  it("BR's seeded stateGrants law books a cost close to the authored baselineStateGrants (isGrant rescale)", () => {
    const grantLaws = brLaws1953.filter((l) => l.isGrant);
    expect(grantLaws.length).toBeGreaterThan(0);
    const share = grantLaws.reduce((s, l) => s + (l.gdpPerCapitaMultiplier ?? 0), 0);
    const booked = share * brConfig.gdp;
    expect(booked).toBeCloseTo(brConfig.baselineStateGrants, -6);
  });

  it("BR's total booked spending (runtime era-cost path) reconciles against revenue within the day-1 sane band", () => {
    // Mirrors the CN/JP/DE runtime-reconciliation tests in budgets1953.test.ts.
    const total = brLaws1953.reduce((sum, law) => {
      const cost = calculateEnactedLawAnnualCost(law, {
        budgetCapacity: 0,
        gdp: brConfig.gdp,
        population: brConfig.population,
        countryId: "BR",
        nationalGdpPerCapita: brConfig.gdp / brConfig.population,
        year: 1953,
      });
      return Number.isFinite(cost) ? sum + (law.isGrant ? 0 : cost) : sum;
    }, 0);
    const authoredTotal = Object.values(brConfig.baselineSpendingByCategory).reduce(
      (a, b) => a + b,
      0
    );
    // Runtime era-cost path (year: 1953) must book the SAME six-category total
    // the seed-time override pins federalBudget.spending.byCategory to (exact
    // rescale via GRANT_OVERRIDE_COUNTRIES/EXTRA_OVERRIDE_CATEGORIES_BY_COUNTRY.BR
    // in budgets.ts), since br_* types carry no gdpCostFraction/incomeCostFraction
    // (only the legacy gdpPerCapitaMultiplier the rescale wrote), so eraSpendingCost
    // falls through to the legacy field for every law.
    expect(total).toBeCloseTo(authoredTotal, -6);
    expect(total / brConfig.gdp).toBeGreaterThan(0.15);
    expect(total / brConfig.gdp).toBeLessThan(0.3);
  });
});

describe("BR legislation module — policy ladders genuinely change the booked cost (gravity, not rails)", () => {
  const spendingTypeIds = [
    "br_social_security_benefits",
    "br_public_health",
    "br_education_funding",
    "br_defense_policy",
    "br_infrastructure_investment",
    "br_general_administration",
    "br_state_grants",
  ] as const;

  it.each(spendingTypeIds)(
    "%s: the max-left and max-right options book different costs than the default",
    (typeId) => {
      const lt = brLegislationTypes.find((t) => t._id === typeId)!;
      const options = lt.policyOptions!;
      const defaultIdx = COUNTRY_POLICY_CONFIGS_1953.br.optionIndexes[typeId];
      const ctx = {
        budgetCapacity: 0,
        gdp: brConfig.gdp,
        population: brConfig.population,
        countryId: "BR",
        nationalGdpPerCapita: brConfig.gdp / brConfig.population,
      };
      const defaultCost = calculatePolicyOptionAnnualCost(options[defaultIdx], ctx, typeId);
      const leftCost = calculatePolicyOptionAnnualCost(options[0], ctx, typeId);
      const rightCost = calculatePolicyOptionAnnualCost(options[options.length - 1], ctx, typeId);
      expect(defaultCost).toBeGreaterThan(0);
      expect(leftCost).toBeGreaterThan(defaultCost!);
      expect(rightCost).toBeLessThan(defaultCost!);
      expect(rightCost).toBeGreaterThan(0);
    }
  );

  it("tax-rate levers: a non-default bracket books a genuinely different rate", () => {
    const incomeTax = brLegislationTypes.find((t) => t._id === "br_income_tax_rate")!;
    const defaultIdx = COUNTRY_POLICY_CONFIGS_1953.br.optionIndexes.br_income_tax_rate;
    expect(incomeTax.policyOptions![defaultIdx].rate).toBe(18);
    expect(incomeTax.policyOptions![0].rate).toBe(0);
    expect(incomeTax.policyOptions!.at(-1)!.rate).toBe(30);
  });

  it("br_state_enterprises and br_labor_law carry no direct cost (structural/political levers, not funding laws)", () => {
    const stateEnterprises = brLegislationTypes.find((t) => t._id === "br_state_enterprises")!;
    const laborLaw = brLegislationTypes.find((t) => t._id === "br_labor_law")!;
    for (const lt of [stateEnterprises, laborLaw]) {
      for (const opt of lt.policyOptions ?? []) {
        expect(opt.annualCostPerCapita, `${lt._id}/${opt.id}`).toBeUndefined();
        expect(opt.gdpPerCapitaMultiplier, `${lt._id}/${opt.id}`).toBeUndefined();
      }
    }
  });
});
