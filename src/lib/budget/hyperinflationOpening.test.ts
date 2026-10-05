import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getInitialNationalBudgetsForPreset } from "@/lib/seeds/reference/budgets";
import {
  advanceHouseholdPriceIndex,
  HOUSEHOLD_PRICE_INDEX_BASELINE,
  HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH,
} from "@/lib/economy/householdPriceIndex";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { calculateCountryInflation } from "./inflation";
import {
  classifyOpeningInflation,
  HYPERINFLATION_MAX_DISINFLATION_SHARE,
  MAX_INFLATION,
  minimumTurnsToOrdinaryRange,
} from "./rules/inflationBounds";

// #3317: 1991 openings authored above the ordinary CPI range.
const HYPERINFLATION_OPENINGS = { BR: 480, BG: 338.45, RO: 230.62, YU: 164, RU: 144 } as const;

const openingBudgets = getInitialNationalBudgetsForPreset("1991-default");

function seededBudget(countryId: string): FederalBudget {
  const budget = openingBudgets.find((b) => b.countryId === countryId);
  if (!budget) throw new Error(`1991-default has no budget for ${countryId}`);
  return structuredClone(budget) as unknown as FederalBudget;
}

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

describe("1991 hyperinflation openings (#3317)", () => {
  it.each(Object.entries(HYPERINFLATION_OPENINGS))(
    "%s keeps its authored CPI through the first recalculation and price-index handoff",
    async (countryId, authored) => {
      const budget = seededBudget(countryId);
      expect(budget.economicFactors.inflationRate).toBe(authored);
      expect(classifyOpeningInflation(authored)).toBe("hyperinflation-recovery");

      const first = await calculateCountryInflation(db as unknown as Db, countryId, budget);
      // Bounded unwind, never a snap to the ordinary ceiling.
      const maxDecline = authored * HYPERINFLATION_MAX_DISINFLATION_SHARE;
      expect(first).toBeLessThanOrEqual(authored);
      expect(first).toBeGreaterThanOrEqual(Math.round((authored - maxDecline) * 100) / 100);
      expect(first).toBeGreaterThan(MAX_INFLATION);

      // The household price index consumes the settled above-range rate.
      const index = advanceHouseholdPriceIndex(budget.economicFactors.householdPriceIndex, first);
      expect(index).toBeCloseTo(
        HOUSEHOLD_PRICE_INDEX_BASELINE *
          (1 + (HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH * first) / 100 / TURNS_PER_YEAR),
        12
      );
      expect(index).toBeGreaterThan(advanceHouseholdPriceIndex(undefined, MAX_INFLATION));
    }
  );

  it.each(Object.entries(HYPERINFLATION_OPENINGS))(
    "%s unwinds monotonically into the ordinary range and then follows ordinary limits",
    async (countryId, authored) => {
      const budget = seededBudget(countryId);
      let rate = authored;
      let index = HOUSEHOLD_PRICE_INDEX_BASELINE;
      let turnsAbove = 0;
      for (let turn = 0; turn < 2 * TURNS_PER_YEAR; turn++) {
        budget.economicFactors.inflationRate = rate;
        const next = await calculateCountryInflation(db as unknown as Db, countryId, budget);
        expect(next).toBeLessThanOrEqual(rate);
        if (rate <= MAX_INFLATION) expect(rate - next).toBeLessThanOrEqual(1.5 + 1e-9);
        if (rate > MAX_INFLATION) turnsAbove++;
        index = advanceHouseholdPriceIndex(index, next);
        rate = next;
      }
      expect(turnsAbove).toBe(minimumTurnsToOrdinaryRange(authored));
      expect(turnsAbove).toBeLessThanOrEqual(TURNS_PER_YEAR + 4);
      expect(rate).toBeLessThan(MAX_INFLATION);
      expect(index).toBeGreaterThan(1);
    }
  );
});

describe("1991 opening CPI seed contract (#3317)", () => {
  it("every authored opening CPI is inside the runtime contract", () => {
    const unsupported = openingBudgets
      .map((b) => ({ countryId: b.countryId, rate: b.economicFactors.inflationRate }))
      .filter(({ rate }) => classifyOpeningInflation(rate) === "unsupported");
    expect(unsupported).toEqual([]);
  });

  it("the out-of-range set is exactly the documented hyperinflation openings", () => {
    const outOfRange = Object.fromEntries(
      openingBudgets
        .filter((b) => classifyOpeningInflation(b.economicFactors.inflationRate) !== "ordinary")
        .map((b) => [b.countryId, b.economicFactors.inflationRate])
    );
    expect(outOfRange).toEqual(HYPERINFLATION_OPENINGS);
  });
});
