import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { calculateEnactedLawAnnualCost } from "@/lib/budget/costs";
import type { EnactedLaw } from "@/lib/db/types/budget";
import { LEGISLATION_COST_CLASS } from "@/lib/era/legislationCostCatalog";
import { bgLegislationTypes } from "@/lib/seeds/bg/bgLegislation";
import { csLegislationTypes } from "@/lib/seeds/cs/csLegislation";
import { huLegislationTypes } from "@/lib/seeds/hu/huLegislation";
import { plLegislationTypes } from "@/lib/seeds/pl/plLegislation";
import { roLegislationTypes } from "@/lib/seeds/ro/roLegislation";
import { uaLegislationTypes } from "@/lib/seeds/ua/uaLegislation";
import { blrLegislationTypes } from "@/lib/seeds/blr/blrLegislation";
import { balLegislationTypes } from "@/lib/seeds/bal/balLegislation";
import { yuLegislationTypes } from "@/lib/seeds/yu/yuLegislation";
import {
  generateDefaultEnactedLaws,
  getInitialNationalBudgetsForPreset,
  NATIONAL_BUDGET_SEED_CONFIGS_1953,
} from "./budgets";

/**
 * Warsaw-Pact six spending legislation (issue: "these six spend nothing").
 *
 * Before this seed, BG/CS/HU/PL/RO/YU each carried 8 legislation types — all
 * revenue/system levers, all cost-class "none" — so `calculateFederalSpending`
 * (src/lib/budget/spending.ts) always fell back to the static
 * `baselineSpendingByCategory`, frozen for the whole game. This file proves:
 *
 *  1. the fallback no longer fires (every category books a real enacted-law
 *     cost, both at seed time via `generateDefaultEnactedLaws` AND via the era-
 *     aware runtime path `calculateEnactedLawAnnualCost`);
 *  2. the default (center-option) booked total reconciles to the country's
 *     OWN authored `baselineSpendingByCategory` (makeEasternBlocBudget1953:
 *     defense 7%, socialSecurity 8%, healthcare 4%, education 5%,
 *     infrastructure 18%, other 7%, stateGrants 5% of GDP); and
 *  3. a non-default policy option genuinely changes the booked cost.
 */

const COUNTRIES = [
  { cc: "BG", prefix: "bg", types: bgLegislationTypes },
  { cc: "CS", prefix: "cs", types: csLegislationTypes },
  { cc: "HU", prefix: "hu", types: huLegislationTypes },
  { cc: "PL", prefix: "pl", types: plLegislationTypes },
  { cc: "RO", prefix: "ro", types: roLegislationTypes },
  { cc: "YU", prefix: "yu", types: yuLegislationTypes },
  // The three western union republics run their own budgets and chambers, so
  // they are held to the same spending ladder as the satellites.
  { cc: "UKR", prefix: "ukr", types: uaLegislationTypes },
  { cc: "BLR", prefix: "blr", types: blrLegislationTypes },
  { cc: "BAL", prefix: "bal", types: balLegislationTypes },
] as const;

const SPENDING_SUFFIXES = [
  "infrastructure_investment",
  "social_security_fund",
  "defense_appropriations",
  "public_health_service",
  "universal_education",
  "state_administration",
  "regional_investment_grants",
] as const;

const CATEGORY_BY_SUFFIX: Record<(typeof SPENDING_SUFFIXES)[number], string> = {
  infrastructure_investment: "infrastructure",
  social_security_fund: "socialSecurity",
  defense_appropriations: "defense",
  public_health_service: "healthcare",
  universal_education: "education",
  state_administration: "other",
  regional_investment_grants: "stateGrants", // isGrant — routed to stateGrants, not byCategory
};

const budgets = getInitialNationalBudgetsForPreset("1953-default");
const byCountry = (cc: string) => budgets.find((b) => b.countryId === cc)!;
const configByCountry = (cc: string) =>
  NATIONAL_BUDGET_SEED_CONFIGS_1953.find((c) => c.countryId === cc)!;

function expectWithinTolerance(actual: number, target: number, tolerance: number) {
  expect(
    Math.abs(actual - target),
    `expected ${actual} to be within ${tolerance * 100}% of ${target}`
  ).toBeLessThanOrEqual(Math.abs(target) * tolerance + 1);
}

describe("Warsaw-Pact six spending legislation — cost class coverage", () => {
  for (const { prefix } of COUNTRIES) {
    it(`${prefix}: every new spending type is classed gdpFraction`, () => {
      for (const suffix of SPENDING_SUFFIXES) {
        expect(LEGISLATION_COST_CLASS[`${prefix}_${suffix}`]).toBe("gdpFraction");
      }
    });
  }
});

describe("Warsaw-Pact six — fallback no longer fires (seed-time)", () => {
  for (const { cc } of COUNTRIES) {
    it(`${cc}: seeded federalBudget books all six categories + state grants (no baseline fallback)`, () => {
      const budget = byCountry(cc);
      for (const cat of [
        "infrastructure",
        "socialSecurity",
        "defense",
        "education",
        "healthcare",
        "other",
      ]) {
        expect(budget.spending.byCategory[cat] ?? 0, `${cc}.${cat}`).toBeGreaterThan(0);
      }
      expect(budget.spending.stateGrants, `${cc}.stateGrants`).toBeGreaterThan(0);
    });
  }
});

describe("Warsaw-Pact six — default option reconciles to the authored baseline", () => {
  for (const { cc } of COUNTRIES) {
    it(`${cc}: seeded spending matches makeEasternBlocBudget1953's authored %GDP within tolerance`, () => {
      const budget = byCountry(cc);
      const config = configByCountry(cc);
      const authored = config.baselineSpendingByCategory;

      // defense/healthcare are pinned EXACTLY by the seed's own historically-
      // sensitive-category rescale (BASELINE_OVERRIDE_CATEGORIES in budgets.ts),
      // so these should match to the cent (allow $1 rounding slack).
      expectWithinTolerance(budget.spending.byCategory.defense, authored.defense, 0.001);
      expectWithinTolerance(budget.spending.byCategory.healthcare, authored.healthcare, 0.001);

      // The remaining four categories + state grants are NOT auto-rescaled —
      // they book whatever the hand-authored gdpCostFraction center option
      // computes, so allow a small hand-calibration tolerance.
      expectWithinTolerance(
        budget.spending.byCategory.infrastructure,
        authored.infrastructure,
        0.02
      );
      expectWithinTolerance(
        budget.spending.byCategory.socialSecurity,
        authored.socialSecurity,
        0.02
      );
      expectWithinTolerance(budget.spending.byCategory.education, authored.education, 0.02);
      expectWithinTolerance(budget.spending.byCategory.other, authored.other, 0.02);
      expectWithinTolerance(budget.spending.stateGrants, config.baselineStateGrants, 0.02);
    });
  }
});

describe("Warsaw-Pact six — non-default policy option genuinely changes the booked cost", () => {
  for (const { prefix, types, cc } of COUNTRIES) {
    it(`${cc}: austerity vs expansion option on ${prefix}_infrastructure_investment book different costs`, () => {
      const config = configByCountry(cc);
      const lt = types.find((t) => t._id === `${prefix}_infrastructure_investment`)!;
      expect(lt).toBeDefined();
      const options = lt.policyOptions ?? [];
      expect(options.length).toBe(5);

      const austerity = options[0]!; // "Investment Freeze Act" — max austerity
      const expansion = options[4]!; // "Forced Industrialisation Act" — max expansion
      const center = options[2]!; // authored default

      expect(austerity.gdpCostFraction).toBeLessThan(center.gdpCostFraction!);
      expect(expansion.gdpCostFraction).toBeGreaterThan(center.gdpCostFraction!);

      const ctx = {
        budgetCapacity: 0,
        gdp: config.gdp,
        population: config.population,
        countryId: cc,
        year: 1953,
      };
      const baseLaw: Omit<EnactedLaw, "gdpCostFraction"> = {
        _id: new ObjectId(),
        billId: new ObjectId(),
        legislationTypeId: lt._id,
        title: "Test enactment",
        scope: "national",
        countryId: cc,
        budgetCategory: "infrastructure",
        enactedAt: new Date(),
        enactedYear: 1953,
        budgetCost: 0,
      };
      const costAusterity = calculateEnactedLawAnnualCost(
        { ...baseLaw, gdpCostFraction: austerity.gdpCostFraction },
        ctx
      );
      const costExpansion = calculateEnactedLawAnnualCost(
        { ...baseLaw, gdpCostFraction: expansion.gdpCostFraction },
        ctx
      );
      expect(costExpansion).toBeGreaterThan(costAusterity);
      expect(costAusterity).toBeCloseTo(austerity.gdpCostFraction! * config.gdp, -2);
      expect(costExpansion).toBeCloseTo(expansion.gdpCostFraction! * config.gdp, -2);
    });
  }
});

describe("Warsaw-Pact six — generateDefaultEnactedLaws books real laws for every new type", () => {
  const allLaws = generateDefaultEnactedLaws("1953-default");
  for (const { cc, prefix } of COUNTRIES) {
    it(`${cc}: an enacted law exists for each of the 7 spending types`, () => {
      const laws = allLaws.filter((l) => l.countryId === cc);
      for (const suffix of SPENDING_SUFFIXES) {
        const law = laws.find((l) => l.legislationTypeId === `${prefix}_${suffix}`);
        expect(law, `${cc}: missing enacted law for ${prefix}_${suffix}`).toBeDefined();
        if (CATEGORY_BY_SUFFIX[suffix] === "stateGrants") {
          expect(law!.isGrant).toBe(true);
        } else {
          expect(law!.budgetCategory).toBe(CATEGORY_BY_SUFFIX[suffix]);
        }
        // defense/healthcare are historically-sensitive categories: budgets.ts
        // rewrites their cost field from gdpCostFraction to a rescaled
        // gdpPerCapitaMultiplier so the seed reproduces the authored baseline
        // exactly (see BASELINE_OVERRIDE_CATEGORIES). Every other category keeps
        // the hand-authored gdpCostFraction untouched.
        const isRescaledCategory =
          CATEGORY_BY_SUFFIX[suffix] === "defense" || CATEGORY_BY_SUFFIX[suffix] === "healthcare";
        if (isRescaledCategory) {
          expect(
            law!.gdpPerCapitaMultiplier,
            `${cc}: ${prefix}_${suffix} has no rescaled gdpPerCapitaMultiplier`
          ).toBeGreaterThan(0);
        } else {
          expect(
            law!.gdpCostFraction,
            `${cc}: ${prefix}_${suffix} has no gdpCostFraction`
          ).toBeGreaterThan(0);
        }
      }
    });
  }
});
