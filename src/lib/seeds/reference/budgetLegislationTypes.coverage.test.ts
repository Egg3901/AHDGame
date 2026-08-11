/**
 * Coverage test for the legislation-type lookup map used by national-budget
 * seed construction.
 *
 * `deriveTaxRates` and `derivePolicyRevenueLines` (in budgets.ts) look up
 * each preset's `taxPolicyIds[*]` and `policyRevenueConfigs[*].legislationTypeId`
 * against a module-private `budgetLegislationTypes` array that aggregates the
 * per-country legislation seed files. If a preset references a country-scoped
 * ID whose seed file was never imported, the lookup silently returns
 * `undefined` and the seed budget falls back to default (often zero) rates.
 *
 * This test rebuilds the same union in the test file and asserts every
 * preset reference resolves, so a future country addition that forgets to
 * import its `*LegislationTypes.ts` here fails loudly.
 */

import { describe, expect, it } from "vitest";

import { legislationTypes } from "./legislationTypes";
import { jpLegislationTypes } from "@/lib/seeds/jp/jpLegislationTypes";
import { deLegislationTypes } from "@/lib/seeds/de/deLegislationTypes";
import { ieLegislationTypes } from "@/lib/seeds/ie/ieLegislationTypes";
import { cnLegislationTypes } from "@/lib/seeds/cn/cnLegislationTypes";

import { getNationalBudgetSeedConfigsForPreset, generateDefaultEnactedLaws } from "./budgets";

const allBudgetLegislationTypes = [
  ...legislationTypes,
  ...jpLegislationTypes,
  ...deLegislationTypes,
  ...ieLegislationTypes,
  ...cnLegislationTypes,
];
const typesById = new Map(allBudgetLegislationTypes.map((lt) => [lt._id, lt] as const));

const PRESETS = ["2019-default", "1991-default"] as const;

/**
 * Countries whose legislation seeds are wired into the unified budget map.
 * Excludes coming-soon countries that have preset references but no
 * corresponding `*LegislationTypes.ts` file yet (BR, NG).
 */
const COVERED_COUNTRIES = new Set(["US", "UK", "JP", "DE", "IE", "CN"]);

describe("budgetLegislationTypes coverage", () => {
  for (const preset of PRESETS) {
    describe(`preset: ${preset}`, () => {
      const configs = getNationalBudgetSeedConfigsForPreset(preset).filter((c) =>
        COVERED_COUNTRIES.has(c.countryId)
      );

      it("returns at least one preset config for the covered countries", () => {
        expect(configs.length).toBeGreaterThan(0);
      });

      it("every taxPolicyIds[*] resolves in the unified legislation map", () => {
        const unresolved: { country: string; tax: string; id: string }[] = [];
        for (const config of configs) {
          for (const [tax, id] of Object.entries(config.taxPolicyIds)) {
            if (!id) continue;
            if (!typesById.has(id)) {
              unresolved.push({ country: config.countryId, tax, id });
            }
          }
        }
        expect(unresolved).toEqual([]);
      });

      it("every policyRevenueConfigs[*].legislationTypeId resolves", () => {
        const unresolved: { country: string; revenueKey: string; id: string }[] = [];
        for (const config of configs) {
          for (const rc of config.policyRevenueConfigs ?? []) {
            if (!typesById.has(rc.legislationTypeId)) {
              unresolved.push({
                country: config.countryId,
                revenueKey: String(rc.revenueKey),
                id: rc.legislationTypeId,
              });
            }
          }
        }
        expect(unresolved).toEqual([]);
      });
    });
  }
});

describe("no legislation option models negative per-capita spending", () => {
  // A policy option's annualCostPerCapita is summed as absolute category spending
  // (budget/spending.ts). A negative value renders as negative spending on the budget
  // page (e.g. "Economic: -$81M") — deregulation/cut options must floor at 0, with their
  // fiscal upside flowing through metric effects, not a phantom budget credit.
  it("every annualCostPerCapita across all legislation types is >= 0", () => {
    const negatives: { type: string; option: string; cost: number }[] = [];
    for (const lt of allBudgetLegislationTypes) {
      for (const opt of lt.policyOptions ?? []) {
        if (typeof opt.annualCostPerCapita === "number" && opt.annualCostPerCapita < 0) {
          negatives.push({ type: lt._id, option: opt.name, cost: opt.annualCostPerCapita });
        }
      }
    }
    expect(negatives).toEqual([]);
  });
});

const IE_SPENDING_CATEGORIES = new Set([
  "health",
  "education",
  "socialProtection",
  "housing",
  "transport",
  "defense",
  "other",
]);
const CN_SPENDING_CATEGORIES = new Set([
  "socialSecurity",
  "education",
  "health",
  "defense",
  "infrastructure",
  "agriculture",
  "publicSafety",
  "other",
]);

describe("IE/CN default spending laws", () => {
  for (const preset of PRESETS) {
    it(`IE emits categorised spending laws for ${preset}`, () => {
      const laws = generateDefaultEnactedLaws(preset).filter((l) => l.countryId === "IE");
      const spending = laws.filter((l) => l.budgetCategory && l.budgetCategory !== "tax");
      expect(spending.length).toBeGreaterThan(10);
      for (const law of spending) {
        expect(IE_SPENDING_CATEGORIES.has(law.budgetCategory)).toBe(true);
      }
      // ≥5 distinct expenditure lines → the budget is populated from laws, not a
      // single-bucket baseline fallback.
      const distinctCategories = new Set(spending.map((l) => l.budgetCategory));
      expect(distinctCategories.size).toBeGreaterThanOrEqual(5);
    });

    it(`CN emits categorised spending laws for ${preset}`, () => {
      const laws = generateDefaultEnactedLaws(preset).filter((l) => l.countryId === "CN");
      const spending = laws.filter((l) => l.budgetCategory && l.budgetCategory !== "tax");
      expect(spending.length).toBeGreaterThan(10);
      for (const law of spending) {
        expect(CN_SPENDING_CATEGORIES.has(law.budgetCategory)).toBe(true);
      }
      const distinctCategories = new Set(spending.map((l) => l.budgetCategory));
      expect(distinctCategories.size).toBeGreaterThanOrEqual(5);
    });
  }
});
