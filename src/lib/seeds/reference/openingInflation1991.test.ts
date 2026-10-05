import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { ALL_COUNTRY_IDS } from "@/lib/constants/countries";
import type { FederalBudget } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { calculateCountryInflation, MAX_INFLATION, MIN_INFLATION } from "@/lib/budget/inflation";
import { applyPerTurnGrowthToFederalBases } from "@/lib/budget/revenue";
import {
  advanceHouseholdPriceIndex,
  HOUSEHOLD_PRICE_INDEX_BASELINE,
} from "@/lib/economy/householdPriceIndex";
import { REAL_WAGE_CLAMP, WAGE_INFLATION_PASSTHROUGH } from "@/lib/metricEngine/registry/economic";
import { getInitialNationalBudgetsForPreset } from "./budgets";
import { OPENING_INFLATION_BOUNDS } from "./openingInflation1991";
import {
  GAMEPLAY_OPENING_INFLATION_1991,
  GAMEPLAY_OPENING_INFLATION_MAX,
  openingInflationProblem,
} from "./rules/openingInflation";

const openings = getInitialNationalBudgetsForPreset("1991-default");

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("gameConfig");
  db.collection("gameState");
  db.collection("macroMetrics");
  db.collection("centralBanks");
  db.collectionMocks.gameConfig.findOne.mockResolvedValue({});
  db.collectionMocks.gameState.findOne.mockResolvedValue({ currentYear: 1991 });
  db.collectionMocks.macroMetrics.findOne.mockResolvedValue({
    economic: { gdpGrowth: { value: -6 }, unemploymentRate: { value: 6 } },
  });
  db.collectionMocks.centralBanks.findOne.mockResolvedValue({ primeRate: 10 });
});

describe("1991 opening inflation seed contract (#3317)", () => {
  it("calibrates against the live runtime constants", () => {
    expect(OPENING_INFLATION_BOUNDS).toEqual({
      minInflation: MIN_INFLATION,
      realWageClamp: REAL_WAGE_CLAMP,
      wageInflationPassthrough: WAGE_INFLATION_PASSTHROUGH,
    });
  });

  it("seeds all 23 countries", () => {
    expect(openings).toHaveLength(23);
  });

  it("every opening is inside the gameplay contract", () => {
    for (const b of openings) {
      expect(
        openingInflationProblem(b.countryId, b.economicFactors, OPENING_INFLATION_BOUNDS),
        b.countryId
      ).toBeNull();
      expect(b.economicFactors.inflationRate, b.countryId).toBeLessThan(MAX_INFLATION);
    }
  });

  it("calibrates exactly the tabled openings and leaves the rest as authored", () => {
    const calibrated = openings
      .filter((b) => GAMEPLAY_OPENING_INFLATION_1991[b.countryId])
      .map((b) => [b.countryId, b.economicFactors.inflationRate]);
    expect(Object.fromEntries(calibrated)).toEqual({
      BR: 12,
      RU: 12,
      TR: 12,
      YU: 15,
      BG: 20,
      RO: 18,
      PL: 16,
      CS: 14,
      HU: 14,
    });
    for (const b of openings) {
      expect(b.economicFactors.inflationRate).toBeLessThanOrEqual(GAMEPLAY_OPENING_INFLATION_MAX);
      expect(b.economicFactors.wageGrowth, b.countryId).toBeLessThan(
        b.economicFactors.inflationRate + 15
      );
    }
  });

  it.each(openings.map((b) => [b.countryId, b] as const))(
    "%s: first runtime calculation stays within the ordinary 1.5pp step and hands off to prices and tax bases",
    async (countryId, opening) => {
      const budget = structuredClone(opening) as unknown as FederalBudget;
      const seeded = budget.economicFactors.inflationRate;
      const validatedCountryId = ALL_COUNTRY_IDS.find((id) => id === countryId);
      if (!validatedCountryId) throw new Error(`Unknown seeded country: ${countryId}`);
      const first = await calculateCountryInflation(
        db as unknown as Db,
        validatedCountryId,
        budget
      );
      expect(Math.abs(first - seeded)).toBeLessThanOrEqual(1.5 + 1e-9);

      const index = advanceHouseholdPriceIndex(budget.economicFactors.householdPriceIndex, first);
      expect(index).toBeGreaterThan(0);
      expect(index / HOUSEHOLD_PRICE_INDEX_BASELINE - 1).toBeLessThan(0.75 / 48 + 1e-12);

      const grown = applyPerTurnGrowthToFederalBases(budget.taxBases, {
        ...budget.economicFactors,
        inflationRate: first,
      });
      const ratio = grown.taxableIncome / budget.taxBases.taxableIncome;
      if (budget.taxBases.taxableIncome > 0) {
        expect(Number.isFinite(ratio)).toBe(true);
        // One turn of the calibrated wage growth, not hundreds of percent a year.
        expect(ratio).toBeLessThan(1 + 15 / 48);
      }
    }
  );
});
