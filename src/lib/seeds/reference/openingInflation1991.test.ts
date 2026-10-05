import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
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
  gameplayOpeningInflation,
  OPENING_INFLATION_KNEE,
  unsupportedOpeningInflation,
} from "./rules/openingInflation";

// #3317: authored historical CPI (provenance) for the calibrated 1991 openings.
const HISTORICAL_CPI_1991: Record<string, number> = {
  BR: 480,
  BG: 338.45,
  RO: 230.62,
  YU: 164,
  RU: 144,
  PL: 76.77,
  TR: 66,
  CS: 55,
  HU: 34.82,
};

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
      maxInflation: MAX_INFLATION,
      realWageClamp: REAL_WAGE_CLAMP,
      wageInflationPassthrough: WAGE_INFLATION_PASSTHROUGH,
    });
  });

  it("seeds all 23 countries", () => {
    expect(openings).toHaveLength(23);
  });

  it("every opening is a supported runtime input", () => {
    for (const b of openings) {
      const f = b.economicFactors;
      expect(unsupportedOpeningInflation(f, OPENING_INFLATION_BOUNDS), b.countryId).toBeNull();
      expect(f.inflationRate, b.countryId).toBeGreaterThanOrEqual(MIN_INFLATION);
      expect(f.inflationRate, b.countryId).toBeLessThan(MAX_INFLATION);
    }
  });

  it("calibrates exactly the authored high-inflation openings and keeps their wages coherent", () => {
    for (const b of openings) {
      const f = b.economicFactors;
      const historical = HISTORICAL_CPI_1991[b.countryId];
      if (historical === undefined) {
        expect(f.inflationRate, b.countryId).toBeLessThanOrEqual(OPENING_INFLATION_KNEE);
        continue;
      }
      expect(f.inflationRate, b.countryId).toBe(gameplayOpeningInflation(historical));
      const [lo, hi] = OPENING_INFLATION_BOUNDS.realWageClamp;
      const real = Math.max(lo, Math.min(hi, f.gdpGrowth));
      expect(f.wageGrowth, b.countryId).toBeCloseTo(
        real + OPENING_INFLATION_BOUNDS.wageInflationPassthrough * f.inflationRate,
        2
      );
      expect(f.wageGrowth, b.countryId).toBeLessThan(f.inflationRate);
    }
  });

  it.each(openings.map((b) => [b.countryId, b] as const))(
    "%s: first runtime calculation stays within the ordinary 1.5pp step and hands off to prices and tax bases",
    async (countryId, opening) => {
      const budget = structuredClone(opening) as unknown as FederalBudget;
      const seeded = budget.economicFactors.inflationRate;
      const first = await calculateCountryInflation(db as unknown as Db, countryId, budget);
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
