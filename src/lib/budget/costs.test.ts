import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  calculatePolicyOptionAnnualCost,
  calculateEnactedLawAnnualCost,
  getGdpIndexedCostScale,
  getSelectedPolicyOption,
  type BudgetCostContext,
} from "./costs";
import type { LegislationPolicyOption, LegislationType, EnactedLaw } from "@/lib/db/types";
import { LEGISLATION_COST_CLASS } from "@/lib/era/legislationCostCatalog";

describe("getGdpIndexedCostScale", () => {
  // UK anchors: low 600B/57.5M = 10434.78 -> 0.31; high 2.9T/68M = 42647.06 -> 1.05
  it("reproduces the PRE scale at the 1991-era GDP-per-capita", () => {
    expect(getGdpIndexedCostScale("UK", 600_000_000_000 / 57_500_000)).toBeCloseTo(0.31, 10);
    expect(getGdpIndexedCostScale("US", 6_200_000_000_000 / 252_177_000)).toBeCloseTo(0.3, 10);
  });

  it("reproduces the MOD scale at the modern GDP-per-capita", () => {
    expect(getGdpIndexedCostScale("UK", 2_900_000_000_000 / 68_000_000)).toBeCloseTo(1.05, 10);
    expect(getGdpIndexedCostScale("DE", 4_500_000_000_000 / 84_400_000)).toBeCloseTo(1.97, 10);
  });

  it("interpolates linearly at the midpoint", () => {
    const lowGpc = 600_000_000_000 / 57_500_000;
    const highGpc = 2_900_000_000_000 / 68_000_000;
    const mid = (lowGpc + highGpc) / 2;
    expect(getGdpIndexedCostScale("UK", mid)).toBeCloseTo((0.31 + 1.05) / 2, 10);
  });

  it("shrinks proportionally below the low anchor and clamps above the high anchor to the MOD scale", () => {
    // F-03: below the 1991 anchor the scale extrapolates ∝ GDP-per-capita
    // (holding the 1991 share of the economy) instead of clamping at scaleLow —
    // clamping charged modern-absolute costs against tiny pre-1991 era GDPs
    // (UK 1953 seeded at 1418% of GDP).
    const ukGpcLow = 600_000_000_000 / 57_500_000;
    expect(getGdpIndexedCostScale("UK", 1)).toBeCloseTo(0.31 / ukGpcLow, 10);
    expect(getGdpIndexedCostScale("UK", ukGpcLow / 2)).toBeCloseTo(0.31 / 2, 10);
    expect(getGdpIndexedCostScale("UK", 10_000_000)).toBeCloseTo(1.05, 10);
  });

  it("keeps a per-capita cost's share of GDP constant below the 1991 anchor", () => {
    // cpc × pop × scale / gdp is invariant for gpc <= gpcLow: the 1953 economy
    // pays the same SHARE of its GDP for a law as the 1991 economy did.
    const ukGpcLow = 600_000_000_000 / 57_500_000;
    const shareAtAnchor = (100 * getGdpIndexedCostScale("UK", ukGpcLow)) / ukGpcLow;
    const gpc1953 = 14_400_000_000 / 50_600_000; // UK 1953 seed
    const shareAt1953 = (100 * getGdpIndexedCostScale("UK", gpc1953)) / gpc1953;
    expect(shareAt1953).toBeCloseTo(shareAtAnchor, 10);
  });

  it("returns 1 for countries with no anchor and for missing inputs", () => {
    expect(getGdpIndexedCostScale("ZZ", 50_000)).toBe(1);
    expect(getGdpIndexedCostScale(undefined, 50_000)).toBe(1);
  });
});

describe("calculatePolicyOptionAnnualCost", () => {
  const context: BudgetCostContext = {
    budgetCapacity: 1_000_000_000,
    gdp: 50_000_000_000,
    population: 10_000_000,
  };

  it("returns undefined when policyOption is undefined", () => {
    expect(calculatePolicyOptionAnnualCost(undefined, context)).toBeUndefined();
  });

  it("calculates cost using gdpPerCapitaMultiplier", () => {
    const policyOption: LegislationPolicyOption = {
      id: "test",
      name: "Test Option",
      stance: "center",
      effectDirection: 1,
      economic: 0,
      social: 0,
      gdpPerCapitaMultiplier: 0.001,
    };

    const cost = calculatePolicyOptionAnnualCost(policyOption, context);
    expect(cost).toBe(50_000_000); // 0.001 * 50 billion
  });

  it("calculates cost using annualCostPerCapita", () => {
    const policyOption: LegislationPolicyOption = {
      id: "test",
      name: "Test Option",
      stance: "center",
      effectDirection: 1,
      economic: 0,
      social: 0,
      annualCostPerCapita: 100,
    };

    const cost = calculatePolicyOptionAnnualCost(policyOption, context);
    expect(cost).toBe(1_000_000_000); // 100 * 10 million
  });

  it("scales annualCostPerCapita by the GDP-indexed scale (proportional below the low anchor)", () => {
    const policyOption: LegislationPolicyOption = {
      id: "test",
      name: "Test Option",
      stance: "center",
      effectDirection: 1,
      economic: 0,
      social: 0,
      annualCostPerCapita: 100,
    };

    const cost = calculatePolicyOptionAnnualCost(policyOption, {
      ...context,
      countryId: "US",
    });
    // Context gpc 5000 is below the US 1991 anchor (~24586), so the scale
    // extrapolates: 0.3 × 5000/24585.87 ≈ 0.061 (F-03; was clamped at 0.3).
    const usGpcLow = 6_200_000_000_000 / 252_177_000;
    expect(cost).toBeCloseTo(100 * 10_000_000 * 0.3 * (5000 / usGpcLow), 6);
  });

  it("prefers gdpPerCapitaMultiplier over annualCostPerCapita when both present", () => {
    const policyOption: LegislationPolicyOption = {
      id: "test",
      name: "Test Option",
      stance: "center",
      effectDirection: 1,
      economic: 0,
      social: 0,
      gdpPerCapitaMultiplier: 0.001,
      annualCostPerCapita: 100,
    };

    const cost = calculatePolicyOptionAnnualCost(policyOption, context);
    expect(cost).toBe(50_000_000); // Uses gdpPerCapitaMultiplier
  });

  it("returns undefined when neither cost field is present", () => {
    const policyOption: LegislationPolicyOption = {
      id: "test",
      name: "Test Option",
      stance: "center",
      effectDirection: 1,
      economic: 0,
      social: 0,
    };

    expect(calculatePolicyOptionAnnualCost(policyOption, context)).toBeUndefined();
  });
});

describe("calculateEnactedLawAnnualCost", () => {
  const context: BudgetCostContext = {
    budgetCapacity: 1_000_000_000,
    gdp: 50_000_000_000,
    population: 10_000_000,
  };

  it("calculates cost using gdpPerCapitaMultiplier", () => {
    const law: EnactedLaw = {
      _id: new ObjectId(),
      billId: new ObjectId(),
      legislationTypeId: "test",
      title: "Test Law",
      scope: "national",
      budgetCategory: "test",
      enactedAt: new Date(),
      enactedYear: 2025,
      gdpPerCapitaMultiplier: 0.002,
      budgetCost: 50,
    };

    const cost = calculateEnactedLawAnnualCost(law, context);
    expect(cost).toBe(100_000_000); // 0.002 * 50 billion
  });

  it("calculates cost using annualCostPerCapita", () => {
    const law: EnactedLaw = {
      _id: new ObjectId(),
      billId: new ObjectId(),
      legislationTypeId: "test",
      title: "Test Law",
      scope: "national",
      budgetCategory: "test",
      enactedAt: new Date(),
      enactedYear: 2025,
      annualCostPerCapita: 50,
      budgetCost: 50,
    };

    const cost = calculateEnactedLawAnnualCost(law, context);
    expect(cost).toBe(500_000_000); // 50 * 10 million
  });

  it("scales enacted absolute costs by the law country's GDP-indexed scale", () => {
    const law: EnactedLaw = {
      _id: new ObjectId(),
      billId: new ObjectId(),
      legislationTypeId: "test",
      title: "Test Law",
      scope: "national",
      countryId: "UK",
      budgetCategory: "test",
      enactedAt: new Date(),
      enactedYear: 1991,
      annualCostPerCapita: 50,
      budgetCost: 50,
    };

    const cost = calculateEnactedLawAnnualCost(law, context);
    // Context gpc 5000 is below the UK 1991 anchor (~10435): scale
    // extrapolates 0.31 × 5000/10434.78 ≈ 0.1485 (F-03; was clamped at 0.31).
    const ukGpcLow = 600_000_000_000 / 57_500_000;
    expect(cost).toBeCloseTo(50 * 10_000_000 * 0.31 * (5000 / ukGpcLow), 6);
  });

  it("is independent of enactedYear (same per-capita, same country, same cost)", () => {
    const base = {
      _id: new ObjectId(),
      billId: new ObjectId(),
      legislationTypeId: "test",
      title: "Test Law",
      scope: "national" as const,
      countryId: "UK" as const,
      budgetCategory: "test",
      enactedAt: new Date(),
      annualCostPerCapita: 50,
      budgetCost: 50,
    };
    const cost1991 = calculateEnactedLawAnnualCost(
      { ...base, enactedYear: 1991 } as EnactedLaw,
      context
    );
    const cost2005 = calculateEnactedLawAnnualCost(
      { ...base, enactedYear: 2005 } as EnactedLaw,
      context
    );
    expect(cost2005).toBe(cost1991);
  });

  it("calculates cost using annualCostUsd", () => {
    const law: EnactedLaw = {
      _id: new ObjectId(),
      billId: new ObjectId(),
      legislationTypeId: "test",
      title: "Test Law",
      scope: "national",
      budgetCategory: "test",
      enactedAt: new Date(),
      enactedYear: 2025,
      annualCostUsd: 25_000_000,
      budgetCost: 50,
    };

    const cost = calculateEnactedLawAnnualCost(law, context);
    expect(cost).toBe(25_000_000);
  });

  it("calculates cost using budgetCost percentage as fallback", () => {
    const law: EnactedLaw = {
      _id: new ObjectId(),
      billId: new ObjectId(),
      legislationTypeId: "test",
      title: "Test Law",
      scope: "national",
      budgetCategory: "test",
      enactedAt: new Date(),
      enactedYear: 2025,
      budgetCost: 25, // 25% of budget capacity
    };

    const cost = calculateEnactedLawAnnualCost(law, context);
    expect(cost).toBe(250_000_000); // 25% of 1 billion
  });

  it("prioritizes gdpPerCapitaMultiplier over other methods", () => {
    const law: EnactedLaw = {
      _id: new ObjectId(),
      billId: new ObjectId(),
      legislationTypeId: "test",
      title: "Test Law",
      scope: "national",
      budgetCategory: "test",
      enactedAt: new Date(),
      enactedYear: 2025,
      gdpPerCapitaMultiplier: 0.001,
      annualCostPerCapita: 100,
      annualCostUsd: 50_000_000,
      budgetCost: 50,
    };

    const cost = calculateEnactedLawAnnualCost(law, context);
    expect(cost).toBe(50_000_000); // Uses gdpPerCapitaMultiplier
  });

  it("prioritizes annualCostPerCapita over annualCostUsd and budgetCost", () => {
    const law: EnactedLaw = {
      _id: new ObjectId(),
      billId: new ObjectId(),
      legislationTypeId: "test",
      title: "Test Law",
      scope: "national",
      budgetCategory: "test",
      enactedAt: new Date(),
      enactedYear: 2025,
      annualCostPerCapita: 100,
      annualCostUsd: 50_000_000,
      budgetCost: 50,
    };

    const cost = calculateEnactedLawAnnualCost(law, context);
    expect(cost).toBe(1_000_000_000); // Uses annualCostPerCapita
  });

  it("prioritizes annualCostUsd over budgetCost", () => {
    const law: EnactedLaw = {
      _id: new ObjectId(),
      billId: new ObjectId(),
      legislationTypeId: "test",
      title: "Test Law",
      scope: "national",
      budgetCategory: "test",
      enactedAt: new Date(),
      enactedYear: 2025,
      annualCostUsd: 75_000_000,
      budgetCost: 50,
    };

    const cost = calculateEnactedLawAnnualCost(law, context);
    expect(cost).toBe(75_000_000); // Uses annualCostUsd
  });

  it("returns 0 when budgetCost is 0", () => {
    const law: EnactedLaw = {
      _id: new ObjectId(),
      billId: new ObjectId(),
      legislationTypeId: "test",
      title: "Test Law",
      scope: "national",
      budgetCategory: "test",
      enactedAt: new Date(),
      enactedYear: 2025,
      budgetCost: 0,
    };

    const cost = calculateEnactedLawAnnualCost(law, context);
    expect(cost).toBe(0);
  });

  // Fiscal-scale audit (2026-07-28): jp_national_health_insurance,
  // jp_article9_sdf, ie_healthcare_policy, ie_defence_spending,
  // cn_medical_insurance, cn_pla_modernization, ng_health_insurance and
  // ng_defense_policy were all generated with a real, non-zero
  // `gdpPerCapitaMultiplier` and NO era-catalog field — but every one of those
  // legislation types IS registered in LEGISLATION_COST_CLASS (perCapita or
  // gdpFraction), so era-year games priced them at a phantom $0: whole
  // healthcare and defense budget lines vanished once a law replaced the
  // baseline-fallback spending, which is why JP/NG/IE's spend-as-%-of-GDP
  // audit finding read far too low. Reproduced below with a synthetic type.
  it("falls through to gdpPerCapitaMultiplier when the era catalog classes the type but this law was never migrated onto it (era year set)", () => {
    LEGISLATION_COST_CLASS.test_health_insurance_era_fallback = "perCapita";
    const law: EnactedLaw = {
      _id: new ObjectId(),
      billId: new ObjectId(),
      legislationTypeId: "test_health_insurance_era_fallback",
      title: "National Health Insurance Act (Default)",
      scope: "national",
      budgetCategory: "healthcare",
      enactedAt: new Date(),
      enactedYear: 1953,
      gdpPerCapitaMultiplier: 0.01423825344091125, // real JP value, refs #jp_national_health_insurance
      budgetCost: 0,
    };

    const eraContext: BudgetCostContext = { ...context, year: 1953 };
    const cost = calculateEnactedLawAnnualCost(law, eraContext);
    // Before the fix this was 0 (eraSpendingCost short-circuited with a
    // defaulted-zero incomeCostFraction before gdpPerCapitaMultiplier was ever
    // reached).
    expect(cost).toBeCloseTo(0.01423825344091125 * eraContext.gdp);
    expect(cost).not.toBe(0);
  });

  it("still honours a genuinely materialized era-catalog zero over gdpPerCapitaMultiplier", () => {
    LEGISLATION_COST_CLASS.test_real_zero_era_cost = "perCapita";
    const law: EnactedLaw = {
      _id: new ObjectId(),
      billId: new ObjectId(),
      legislationTypeId: "test_real_zero_era_cost",
      title: "Abolished Programme",
      scope: "national",
      budgetCategory: "healthcare",
      enactedAt: new Date(),
      enactedYear: 1953,
      incomeCostFraction: 0, // explicitly materialized, real zero
      gdpPerCapitaMultiplier: 0.05, // must NOT be reached
      budgetCost: 0,
    };

    const eraContext: BudgetCostContext = { ...context, year: 1953 };
    expect(calculateEnactedLawAnnualCost(law, eraContext)).toBe(0);
  });
});

describe("getSelectedPolicyOption", () => {
  const legislationType: LegislationType = {
    _id: "tax-policy",
    name: "Tax Policy",
    description: "Tax policy legislation",
    policyDomain: "economic",
    subCategory: "income-tax",
    positions: [],
    policyOptions: [
      {
        id: "strong-cut",
        name: "Strong Cut",
        stance: "right",
        effectDirection: 1,
        economic: 2,
        social: 0,
        rate: 15,
      },
      {
        id: "moderate-cut",
        name: "Moderate Cut",
        stance: "right",
        effectDirection: 1,
        economic: 1,
        social: 0,
        rate: 20,
      },
      {
        id: "status-quo",
        name: "Status Quo",
        stance: "center",
        effectDirection: 0,
        economic: 0,
        social: 0,
        rate: 25,
      },
      {
        id: "moderate-increase",
        name: "Moderate Increase",
        stance: "left",
        effectDirection: -1,
        economic: -1,
        social: 0,
        rate: 30,
      },
      {
        id: "strong-increase",
        name: "Strong Increase",
        stance: "left",
        effectDirection: -1,
        economic: -2,
        social: 0,
        rate: 35,
      },
    ],
  };

  it("returns undefined when policyOptions is empty", () => {
    const emptyLegType: LegislationType = {
      _id: "empty",
      name: "Empty",
      description: "Empty legislation",
      policyDomain: "economic",
      subCategory: "test",
      positions: [],
      policyOptions: [],
    };

    expect(
      getSelectedPolicyOption(emptyLegType, {
        legislationTypeId: "empty",
        effectDirection: 1,
      })
    ).toBeUndefined();
  });

  it("finds policy option by policyOptionId (bill with provisions)", () => {
    const bill = {
      legislationTypeId: "tax-policy",
      effectDirection: 1,
      provisions: [
        {
          legislationTypeId: "tax-policy",
          policyOptionId: "moderate-cut",
          effectDirection: 1,
        },
      ],
    };

    const option = getSelectedPolicyOption(legislationType, bill);
    expect(option).toEqual(expect.objectContaining({ id: "moderate-cut", rate: 20 }));
  });

  it("finds policy option by effectDirection when policyOptionId not provided (bill with provisions)", () => {
    const bill = {
      legislationTypeId: "tax-policy",
      effectDirection: 1,
      provisions: [
        {
          legislationTypeId: "tax-policy",
          effectDirection: 1,
        },
      ],
    };

    const option = getSelectedPolicyOption(legislationType, bill);
    expect(option).toEqual(
      expect.objectContaining({ id: "strong-cut", effectDirection: 1, rate: 15 })
    );
  });

  it("finds policy option by policyOptionId (direct selection)", () => {
    const selection = {
      legislationTypeId: "tax-policy",
      policyOptionId: "strong-increase",
      effectDirection: -2,
    };

    const option = getSelectedPolicyOption(legislationType, selection);
    expect(option).toEqual(expect.objectContaining({ id: "strong-increase", rate: 35 }));
  });

  it("finds policy option by effectDirection when policyOptionId not provided (direct selection)", () => {
    const selection = {
      legislationTypeId: "tax-policy",
      effectDirection: -1,
    };

    const option = getSelectedPolicyOption(legislationType, selection);
    expect(option).toEqual(expect.objectContaining({ effectDirection: -1, rate: 30 }));
  });

  it("returns undefined when effectDirection does not match any option", () => {
    const selection = {
      legislationTypeId: "tax-policy",
      effectDirection: 5, // No option has this effectDirection
    };

    const option = getSelectedPolicyOption(legislationType, selection);
    expect(option).toBeUndefined();
  });

  it("returns undefined when selection has no provisions matching legislation type", () => {
    const bill = {
      legislationTypeId: "other-policy",
      effectDirection: 1,
      provisions: [
        {
          legislationTypeId: "other-policy",
          effectDirection: 1,
        },
      ],
    };

    const option = getSelectedPolicyOption(legislationType, bill);
    expect(option).toBeUndefined();
  });

  it("falls back to effectDirection when policyOptionId does not exist", () => {
    const bill = {
      legislationTypeId: "tax-policy",
      effectDirection: 1,
      provisions: [
        {
          legislationTypeId: "tax-policy",
          policyOptionId: "nonexistent",
          effectDirection: 1,
        },
      ],
    };

    const option = getSelectedPolicyOption(legislationType, bill);
    expect(option).toEqual(
      expect.objectContaining({ id: "strong-cut", effectDirection: 1, rate: 15 })
    );
  });

  it("handles legislation type without policyOptions array", () => {
    const legTypeNoOptions: LegislationType = {
      _id: "no-options",
      name: "No Options",
      description: "Legislation with no options",
      policyDomain: "economic",
      subCategory: "test",
      positions: [],
    };

    const selection = {
      legislationTypeId: "no-options",
      effectDirection: 1,
    };

    expect(getSelectedPolicyOption(legTypeNoOptions, selection)).toBeUndefined();
  });
});
