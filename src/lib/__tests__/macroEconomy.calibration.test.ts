/**
 * Macro Economy Calibration Tests
 *
 * Verifies the GDP growth and inflation pipeline produces correct directional behavior
 * across reference scenarios. These test pure functions only — no DB mocking needed.
 *
 * GDP growth is now computed from revenue-weighted average of sector growth rates:
 * - Owned sectors contribute their player-set growthRate
 * - Unowned sectors default to 1% background growth
 * - No annualization — the weighted average IS the daily GDP growth rate
 *
 * Note: unemployment is policy-driven and handled by policyEffects.ts.
 */

import { describe, it, expect } from "vitest";
import { computeWeightedGrowthRate } from "@/lib/turn/gdpGrowth";
import {
  calculateInflation,
  computeEffectivePrimeRate,
  type InflationInputs,
} from "@/lib/budget/inflation";
import { scoreMetric } from "@/lib/utils/metricScoring";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build inflation inputs from scenario parameters */
function makeInflationInputs(overrides: Partial<InflationInputs> = {}): InflationInputs {
  return {
    unemployment: 5.0,
    gdpGrowth: 2.0,
    primeRate: 3.0,
    surplusToGdp: -0.03, // 3% deficit
    tariffRate: 3.0,
    wageGrowth: 3.0,
    commodityPressure: 0.0,
    forexPressure: 0.0,
    savingsPressure: 0.0,
    previousInflation: 2.0,
    ...overrides,
  };
}

// ── Scenario Tests ───────────────────────────────────────────────────────────

describe("macro economy calibration", () => {
  describe("GDP growth calculation", () => {
    it("returns DEFAULT_UNOWNED_GROWTH_RATE (0.5%) when no sectors exist", () => {
      expect(computeWeightedGrowthRate([], [])).toBe(0.5);
    });

    it("uses player-set growthRate for owned sectors", () => {
      // Single owned sector with 2% growth rate
      const owned = [{ revenue: 1000, currentGrowthRate: 2 }];
      expect(computeWeightedGrowthRate(owned, [])).toBe(2);
    });

    it("defaults unowned sectors to 0.5% background growth", () => {
      // Only unowned sectors → 2% background growth (neutral rate)
      const unowned = [{ revenue: 1000 }];
      expect(computeWeightedGrowthRate([], unowned)).toBe(0.5);
    });

    it("weights sectors by revenue", () => {
      // 2000 revenue @ 0% = 0 weighted
      // 2000 revenue @ 4% = 8000 weighted
      // Total: 4000 revenue, 8000 weighted → 2%
      const owned = [
        { revenue: 2000, currentGrowthRate: 0 },
        { revenue: 2000, currentGrowthRate: 4 },
      ];
      expect(computeWeightedGrowthRate(owned, [])).toBe(2);
    });

    it("blends owned and unowned sectors", () => {
      // Owned: 3000 @ 3% = 9000 weighted
      // Unowned: 1000 @ 2% = 2000 weighted
      // Total: 4000 revenue, 11000 weighted → 2.75%
      const owned = [{ revenue: 3000, currentGrowthRate: 3 }];
      const unowned = [{ revenue: 1000 }];
      expect(computeWeightedGrowthRate(owned, unowned)).toBe(2.375);
    });

    it("produces moderate GDP growth from typical sector mix", () => {
      // Typical mix: owned at 2%, unowned at 2% (neutral) → 2% GDP growth
      // 500K owned @ 2% + 500K unowned @ 2% = 2.0% GDP growth
      const owned = [{ revenue: 500_000, currentGrowthRate: 2 }];
      const unowned = [{ revenue: 500_000 }];
      expect(computeWeightedGrowthRate(owned, unowned)).toBe(1.25);
    });

    it("high player growth drives high GDP growth when dominant", () => {
      // If players control most revenue and set high growth:
      // 900K owned @ 5% + 100K unowned @ 2% = 4.7% GDP growth
      const owned = [{ revenue: 900_000, currentGrowthRate: 5 }];
      const unowned = [{ revenue: 100_000 }];
      expect(computeWeightedGrowthRate(owned, unowned)).toBeCloseTo(4.55, 1);
    });

    it("can reach severe recession levels when owned sectors contract", () => {
      const owned = [{ revenue: 100, currentGrowthRate: -8 }];
      const unowned = [{ revenue: 50 }];
      expect(computeWeightedGrowthRate(owned, unowned)).toBeLessThan(-5);
    });
  });

  describe("Hermes metric coverage", () => {
    it("scores newly added cross-cutting and DE metrics", () => {
      for (const [metricId, sampleValue] of Object.entries({
        tradeBalance: 5,
        productivityGrowth: 2,
        rdIntensity: 3,
        exportDependency: 40,
        manufacturingCompetitiveness: 75,
        apprenticeshipRate: 4,
        energyTransitionProgress: 65,
        coDeterminationQuality: 70,
        debtToGdp: 100,
        housingSupplyGrowth: 2,
      })) {
        const score = scoreMetric(metricId, sampleValue);
        expect(score).not.toBeNull();
        expect(score!).toBeGreaterThanOrEqual(0);
        expect(score!).toBeLessThanOrEqual(100);
      }
    });
  });

  describe("scenario: neutral economy", () => {
    it("produces near-target inflation (~2%)", () => {
      const inflation = calculateInflation(makeInflationInputs());
      expect(inflation).toBeGreaterThan(1.0);
      expect(inflation).toBeLessThan(4.0);
    });
  });

  describe("scenario: recession", () => {
    it("inflation falls with negative GDP growth and high unemployment", () => {
      const normalInflation = calculateInflation(makeInflationInputs());
      const recessionInflation = calculateInflation(
        makeInflationInputs({
          gdpGrowth: -2.0,
          unemployment: 10.0,
        })
      );
      expect(recessionInflation).toBeLessThan(normalInflation);
    });
  });

  describe("scenario: overheating", () => {
    it("inflation rises with hot GDP growth and low unemployment", () => {
      const normalInflation = calculateInflation(makeInflationInputs());
      const hotInflation = calculateInflation(
        makeInflationInputs({
          gdpGrowth: 5.0,
          unemployment: 3.0,
        })
      );
      expect(hotInflation).toBeGreaterThan(normalInflation);
    });
  });

  describe("scenario: stagflation", () => {
    it("inflation stays elevated despite low growth when supply costs are high", () => {
      const stagflation = calculateInflation(
        makeInflationInputs({
          gdpGrowth: 0.5,
          unemployment: 8.0,
          tariffRate: 10.0, // supply shock from tariffs
          wageGrowth: 5.0, // wage-price spiral
          previousInflation: 4.0,
        })
      );
      // Inflation should remain above target despite weak growth
      expect(stagflation).toBeGreaterThan(2.5);
    });
  });

  describe("scenario: disinflation", () => {
    it("inflation falls toward target when rate is restrictive", () => {
      const elevated = calculateInflation(
        makeInflationInputs({
          gdpGrowth: 2.0,
          unemployment: 5.0,
          primeRate: 6.0, // restrictive
          previousInflation: 4.0,
        })
      );
      // Should be below previous 4% due to restrictive rate
      expect(elevated).toBeLessThan(4.0);
    });
  });

  // ── Invariant Tests ──────────────────────────────────────────────────────────

  describe("invariants", () => {
    it("lower unemployment → higher inflation (Phillips curve sign)", () => {
      const lowUnemp = calculateInflation(makeInflationInputs({ unemployment: 3.0 }));
      const highUnemp = calculateInflation(makeInflationInputs({ unemployment: 8.0 }));
      expect(lowUnemp).toBeGreaterThan(highUnemp);
    });

    it("higher GDP growth → higher inflation (demand pull sign)", () => {
      const lowGrowth = calculateInflation(makeInflationInputs({ gdpGrowth: 0.0 }));
      const highGrowth = calculateInflation(makeInflationInputs({ gdpGrowth: 5.0 }));
      expect(highGrowth).toBeGreaterThan(lowGrowth);
    });

    it("rate cut increases inflation within the effective rate model", () => {
      // Spot rate drops from 5.0 to 2.0 with history at 5.0
      const before = computeEffectivePrimeRate(5.0, Array(12).fill(5.0));
      const after = computeEffectivePrimeRate(2.0, Array(12).fill(5.0));
      // Lower effective rate → higher inflation (loose money)
      expect(after).toBeLessThan(before);
    });

    it("rate hike reduces inflation within the effective rate model", () => {
      // Spot rate rises from 2.0 to 5.0 with history at 2.0
      const before = computeEffectivePrimeRate(2.0, Array(12).fill(2.0));
      const after = computeEffectivePrimeRate(5.0, Array(12).fill(2.0));
      // Higher effective rate → lower inflation (tight money)
      expect(after).toBeGreaterThan(before);
    });
  });
});
