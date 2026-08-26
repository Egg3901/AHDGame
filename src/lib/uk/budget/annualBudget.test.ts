import { describe, expect, it } from "vitest";
import {
  buildAnnualBudgetProvisions,
  previewAnnualBudget,
  resolveAnnualBudgetAuthority,
} from "./annualBudget";
import { getLaw } from "@/lib/politicalLegislation/catalog";

describe("resolveAnnualBudgetAuthority", () => {
  it("gives the appointed Chancellor authoring authority", () => {
    expect(resolveAnnualBudgetAuthority("chancellor", "chancellor", "prime-minister")).toBe(
      "chancellor"
    );
  });

  it("lets the Prime Minister act only while the Chancellorship is vacant", () => {
    expect(resolveAnnualBudgetAuthority("prime-minister", null, "prime-minister")).toBe(
      "acting_pm"
    );
    expect(resolveAnnualBudgetAuthority("prime-minister", "chancellor", "prime-minister")).toBe(
      "none"
    );
  });
});

function fakeDb() {
  return {
    collection(name: string) {
      if (name === "federalBudget") {
        return {
          findOne: async () => ({
            _id: "UK",
            countryId: "UK",
            taxRates: { incomeTax: 45, payrollTax: 10 },
          }),
        };
      }
      if (name === "statePolicies") {
        return {
          find: () => ({
            toArray: async () => [
              {
                legislationTypeId: "uk.defense.armedForces.primary",
                policyOptionIndex: 3,
              },
            ],
          }),
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  } as never;
}

describe("buildAnnualBudgetProvisions", () => {
  it("compiles changed tax rates and programme levels into ordinary UK policy provisions", async () => {
    const result = await buildAnnualBudgetProvisions(fakeDb(), {
      taxRates: {
        "uk.tax.incomeTax": 50,
        "uk.tax.payrollTax": 10,
      },
      programLevels: {
        "uk.defense.armedForces.primary": 1,
      },
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.provisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          legislationTypeId: "uk.tax.incomeTax",
          proposedRate: 50,
          policyOptionId: "rate:50",
        }),
        expect.objectContaining({
          legislationTypeId: "uk.defense.armedForces.primary",
          policyOptionId: "l1",
        }),
      ])
    );
    expect(result.provisions).toHaveLength(2);
  });

  it("does not repeal an untouched programme that is still at its statutory baseline", async () => {
    const law = getLaw("uk.defense.armedForces.primary");
    if (!law) throw new Error("fixture law missing");
    const db = {
      collection(name: string) {
        if (name === "federalBudget") {
          return {
            findOne: async () => ({ _id: "UK", taxRates: { incomeTax: 45 } }),
          };
        }
        if (name === "statePolicies") {
          return { find: () => ({ toArray: async () => [] }) };
        }
        throw new Error(`unexpected collection: ${name}`);
      },
    } as never;

    const result = await buildAnnualBudgetProvisions(db, {
      taxRates: { "uk.tax.incomeTax": 46 },
      programLevels: { [law.id]: law.baselineLevel ?? 0 },
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.provisions).toHaveLength(1);
    expect(result.provisions[0]).toMatchObject({ legislationTypeId: "uk.tax.incomeTax" });
  });

  it("rejects impossible law levels instead of creating an inert Budget", async () => {
    const result = await buildAnnualBudgetProvisions(fakeDb(), {
      taxRates: {},
      programLevels: { "uk.defense.armedForces.primary": 9 },
    });

    expect(result).toEqual({
      ok: false,
      error: "Armed Forces and National Service Act level must be between 0 and 4.",
    });
  });
});

describe("previewAnnualBudget", () => {
  it("forecasts the same tax and programme changes that the omnibus bill will enact", async () => {
    const db = {
      collection(name: string) {
        if (name === "federalBudget") {
          return {
            findOne: async () => ({
              _id: "UK",
              countryId: "UK",
              gdp: 1_000,
              taxRates: { incomeTax: 20 },
              taxBases: { taxableIncome: 500 },
              revenue: {
                incomeTax: 100,
                lawRevenue: 20,
                other: 100,
                healthcareIncome: 0,
                taxLikeRevenue: 120,
                taxLikeRevenueAfterCap: 120,
                total: 220,
              },
              spending: { byCategory: { defense: 300 }, debtInterest: 100, total: 500 },
              debt: { principal: 1_500, interestRate: 0.04, ceiling: 2_000 },
            }),
          };
        }
        if (name === "statePolicies") {
          return {
            find: () => ({
              toArray: async () => [
                {
                  legislationTypeId: "uk.defense.armedForces.primary",
                  policyOptionIndex: 3,
                },
              ],
            }),
          };
        }
        if (name === "states") {
          return { find: () => ({ toArray: async () => [{ gdp: 0.001, population: 1 }] }) };
        }
        throw new Error(`unexpected collection: ${name}`);
      },
    } as never;

    const result = await previewAnnualBudget(db, {
      taxRates: { "uk.tax.incomeTax": 30 },
      programLevels: { "uk.defense.armedForces.primary": 1 },
    });

    expect(result).toMatchObject({
      ok: true,
      current: { revenue: 220, spending: 500, balance: -280 },
      projected: { revenue: 270, spending: 477.3, balance: -207.3 },
      categoryDeltas: { defense: -22.7 },
      phaseInTurns: 10,
    });
  });
});
