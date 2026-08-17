import { describe, expect, it } from "vitest";
import {
  computeSectorLaborCost,
  getSectorLaborShare,
  eraLaborMultiplier,
  clampWageLevel,
  clampKaitzRatio,
  buildMinWageRatioByCountry,
  MIN_WAGE_KAITZ_MAX,
  minWageFloorMultiplier,
  makeWageIndexAccumulator,
  accumulateWageIndex,
  resolveWageIndex,
  labourMigrationWageFactor,
  labourWageIncomePassthrough,
  LABOUR_WAGE_PASSTHROUGH,
  labourUnemploymentWagePressure,
  LABOUR_UNEMPLOYMENT_WAGE_K,
  LABOUR_UNEMPLOYMENT_WAGE_CAP_PP,
  makeAutomationIndexAccumulator,
  accumulateAutomationIndex,
  resolveAutomationIndex,
  labourUnemploymentAutomationPressure,
  LABOUR_UNEMPLOYMENT_AUTOMATION_K,
  LABOUR_UNEMPLOYMENT_AUTOMATION_CAP_PP,
  sectorWageLevel,
  SECTOR_LABOR_INTENSITY,
  SECTOR_WAGE_LEVEL,
  MEDIAN_SECTOR_WAGE_LEVEL,
  LABOUR_DEFAULT_LABOR_SHARE,
  WAGE_LEVEL_MIN,
  WAGE_LEVEL_MAX,
  WAGE_LEVEL_DEFAULT,
} from "./laborCost";

describe("computeSectorLaborCost", () => {
  // Core safety guarantee: at wageMultiplier=1 the labor/non-labor split sums
  // back to gross maintenance for ANY inputs, so profit is unchanged vs. the
  // pre-labour economy. Labor is carved OUT of maintenance, never added on top.
  it("is profit-invariant at wageMultiplier=1 (split === gross maintenance)", () => {
    const cases = [
      { hourlyRevenue: 1_000, grossMaintenance: 650, laborShare0: 0.2 },
      { hourlyRevenue: 42_000, grossMaintenance: 21_000, laborShare0: 0.18 },
      { hourlyRevenue: 5, grossMaintenance: 4.9, laborShare0: 0.26 },
      { hourlyRevenue: 1_000, grossMaintenance: 100, laborShare0: 0.2 }, // thin margin
    ];
    for (const c of cases) {
      const r = computeSectorLaborCost({ ...c, wageMultiplier: 1 });
      expect(r.maintenance).toBeCloseTo(c.grossMaintenance, 9);
      expect(r.maintenanceNonLabor + r.laborCost).toBeCloseTo(c.grossMaintenance, 9);
    }
  });

  it("raises total maintenance above gross when the multiplier > 1", () => {
    const r = computeSectorLaborCost({
      hourlyRevenue: 1_000,
      grossMaintenance: 650,
      laborShare0: 0.2, // baseline labor = 200
      wageMultiplier: 1.5,
    });
    expect(r.baselineLaborCost).toBeCloseTo(200, 9);
    expect(r.laborCost).toBeCloseTo(300, 9);
    expect(r.maintenance).toBeCloseTo(750, 9);
  });

  it("lowers total maintenance below gross when the multiplier < 1 (e.g. automation)", () => {
    const r = computeSectorLaborCost({
      hourlyRevenue: 1_000,
      grossMaintenance: 650,
      laborShare0: 0.2,
      wageMultiplier: 0.5,
    });
    expect(r.laborCost).toBeCloseTo(100, 9);
    expect(r.maintenance).toBeCloseTo(550, 9);
  });

  it("never carves out more labor than the maintenance that exists", () => {
    const r = computeSectorLaborCost({
      hourlyRevenue: 1_000,
      grossMaintenance: 100,
      laborShare0: 0.3, // 300 > 100 → clamp to 100
      wageMultiplier: 1,
    });
    expect(r.baselineLaborCost).toBeCloseTo(100, 9);
    expect(r.maintenanceNonLabor).toBeCloseTo(0, 9);
    expect(r.maintenance).toBeCloseTo(100, 9);
  });
});

describe("minWageFloorMultiplier (Kaitz)", () => {
  it("is 1 (no floor) when the ratio is 0 or negative", () => {
    expect(minWageFloorMultiplier("retail", 0)).toBe(1);
    expect(minWageFloorMultiplier("retail", -0.5)).toBe(1);
  });

  it("floors low-pay sectors but leaves high-pay sectors untouched", () => {
    // Floor = ratio × median. retail/agriculture sit below the median pay level;
    // technology/financial sit well above.
    const ratio = 0.8;
    expect(minWageFloorMultiplier("retail", ratio)).toBeGreaterThan(1);
    expect(minWageFloorMultiplier("agriculture", ratio)).toBeGreaterThan(1);
    expect(minWageFloorMultiplier("technology", ratio)).toBe(1);
    expect(minWageFloorMultiplier("financial", ratio)).toBe(1);
  });

  it("raises labor cost proportionally to how far below the floor a sector sits", () => {
    const ratio = 1.0; // floor = the median wage level itself
    const floor = ratio * MEDIAN_SECTOR_WAGE_LEVEL;
    const expected = floor / SECTOR_WAGE_LEVEL.retail;
    expect(minWageFloorMultiplier("retail", ratio)).toBeCloseTo(expected, 9);
    // agriculture is paid less than retail → a bigger lift.
    expect(minWageFloorMultiplier("agriculture", ratio)).toBeGreaterThan(
      minWageFloorMultiplier("retail", ratio)
    );
  });

  it("a higher ratio pulls more sectors over the floor", () => {
    const low = minWageFloorMultiplier("logistics", 0.6);
    const high = minWageFloorMultiplier("logistics", 0.95);
    expect(low).toBe(1); // logistics clears a modest floor
    expect(high).toBeGreaterThan(1); // but not an aggressive one
  });
});

describe("labour wage index (v2 per-state aggregate)", () => {
  it("is 1.0 at baseline (all sectors wageLevel=1, no floor)", () => {
    const acc = makeWageIndexAccumulator();
    accumulateWageIndex(acc, 100, 1, 1);
    accumulateWageIndex(acc, 400, 1, 1);
    expect(resolveWageIndex(acc)).toBeCloseTo(1, 9);
  });

  it("is worker-weighted (a big low-wage sector dominates a small high-wage one)", () => {
    const acc = makeWageIndexAccumulator();
    accumulateWageIndex(acc, 10, 1.5, 1); // few workers at 1.5×
    accumulateWageIndex(acc, 90, 1.0, 1); // many at baseline
    // (10×1.5 + 90×1.0) / 100 = 1.05
    expect(resolveWageIndex(acc)).toBeCloseTo(1.05, 9);
  });

  it("folds in the minimum-wage floor multiplier", () => {
    const acc = makeWageIndexAccumulator();
    accumulateWageIndex(acc, 100, 1, 1.3); // floor lifts pay 30%
    expect(resolveWageIndex(acc)).toBeCloseTo(1.3, 9);
  });

  it("returns 1.0 (baseline) for a state with no workers", () => {
    expect(resolveWageIndex(makeWageIndexAccumulator())).toBe(1);
  });
});

describe("automation index (v2-3b per-state aggregate)", () => {
  it("is 1.0 at baseline (no automation tech)", () => {
    const acc = makeAutomationIndexAccumulator();
    accumulateAutomationIndex(acc, 100, 1);
    accumulateAutomationIndex(acc, 400, 1);
    expect(resolveAutomationIndex(acc)).toBeCloseTo(1, 9);
  });

  it("is worker-weighted (a big automated sector dominates a small unautomated one)", () => {
    const acc = makeAutomationIndexAccumulator();
    accumulateAutomationIndex(acc, 10, 1.0); // few workers, no automation
    accumulateAutomationIndex(acc, 90, 0.8); // many at 20% labor-cost reduction
    // (10×1.0 + 90×0.8) / 100 = 0.82
    expect(resolveAutomationIndex(acc)).toBeCloseTo(0.82, 9);
  });

  it("returns 1.0 (baseline) for a state with no workers", () => {
    expect(resolveAutomationIndex(makeAutomationIndexAccumulator())).toBe(1);
  });
});

describe("labourUnemploymentAutomationPressure (v2-3b jobs coupling, automation half)", () => {
  it("is exactly 0 at no change (parity)", () => {
    expect(labourUnemploymentAutomationPressure(0)).toBe(0);
  });

  it("maps non-finite delta to 0", () => {
    expect(labourUnemploymentAutomationPressure(Number.NaN)).toBe(0);
    expect(labourUnemploymentAutomationPressure(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("more automation (index DROPS, negative Δ) RAISES the pressure — sign inverted vs the wage term", () => {
    const pressure = labourUnemploymentAutomationPressure(-0.1);
    expect(pressure).toBeGreaterThan(0);
    expect(pressure).toBeCloseTo(0.1 * LABOUR_UNEMPLOYMENT_AUTOMATION_K, 9);
  });

  it("less automation (index RISES, positive Δ — e.g. automation tech lost/reverted) lowers the pressure", () => {
    expect(labourUnemploymentAutomationPressure(0.1)).toBeLessThan(0);
  });

  it("is explicitly capped per turn, independent of the node's own bounds", () => {
    expect(labourUnemploymentAutomationPressure(-5)).toBe(LABOUR_UNEMPLOYMENT_AUTOMATION_CAP_PP);
    expect(labourUnemploymentAutomationPressure(5)).toBe(-LABOUR_UNEMPLOYMENT_AUTOMATION_CAP_PP);
  });
});

describe("labourMigrationWageFactor (v2 migration coupling)", () => {
  it("is exactly 1.0 at the baseline index (parity)", () => {
    expect(labourMigrationWageFactor(1)).toBe(1);
    expect(labourMigrationWageFactor(Number.NaN)).toBe(1);
  });

  it("above-baseline wages attract (>1), below-baseline repel (<1)", () => {
    expect(labourMigrationWageFactor(1.2)).toBeCloseTo(1.1, 9); // +20% index → +10% pull
    expect(labourMigrationWageFactor(0.8)).toBeCloseTo(0.9, 9);
  });

  it("is bounded so it can only modulate, not dominate, the output-gap pull", () => {
    expect(labourMigrationWageFactor(5)).toBe(1.3); // clamp ceiling
    expect(labourMigrationWageFactor(-5)).toBe(0.7); // clamp floor
  });
});

describe("labourWageIncomePassthrough (v2-2 income coupling)", () => {
  it("is exactly 0 at no change (parity)", () => {
    expect(labourWageIncomePassthrough(0)).toBe(0);
  });

  it("maps non-finite delta to 0", () => {
    expect(labourWageIncomePassthrough(Number.NaN)).toBe(0);
    expect(labourWageIncomePassthrough(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("scales the index delta by 100 × LABOUR_WAGE_PASSTHROUGH", () => {
    expect(labourWageIncomePassthrough(0.1)).toBeCloseTo(0.1 * 100 * LABOUR_WAGE_PASSTHROUGH, 9);
  });

  it("is negative for a wage cut", () => {
    expect(labourWageIncomePassthrough(-0.2)).toBeLessThan(0);
  });
});

describe("labourUnemploymentWagePressure (v2-3a jobs coupling, wage half)", () => {
  it("is exactly 0 at no change (parity)", () => {
    expect(labourUnemploymentWagePressure(0)).toBe(0);
  });

  it("maps non-finite delta to 0", () => {
    expect(labourUnemploymentWagePressure(Number.NaN)).toBe(0);
    expect(labourUnemploymentWagePressure(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("a wage hike (positive Δ) raises the pressure (more unemployment)", () => {
    expect(labourUnemploymentWagePressure(0.1)).toBeCloseTo(0.1 * LABOUR_UNEMPLOYMENT_WAGE_K, 9);
  });

  it("a wage cut (negative Δ) lowers the pressure (less unemployment)", () => {
    expect(labourUnemploymentWagePressure(-0.1)).toBeLessThan(0);
  });

  it("is explicitly capped per turn, independent of the node's own bounds", () => {
    expect(labourUnemploymentWagePressure(5)).toBe(LABOUR_UNEMPLOYMENT_WAGE_CAP_PP);
    expect(labourUnemploymentWagePressure(-5)).toBe(-LABOUR_UNEMPLOYMENT_WAGE_CAP_PP);
  });
});

describe("clampKaitzRatio", () => {
  it("clamps into [0, max] and maps non-finite to 0", () => {
    expect(clampKaitzRatio(0.5)).toBe(0.5);
    expect(clampKaitzRatio(-0.2)).toBe(0);
    expect(clampKaitzRatio(2)).toBe(MIN_WAGE_KAITZ_MAX);
    expect(clampKaitzRatio(Number.NaN)).toBe(0);
  });
});

describe("buildMinWageRatioByCountry", () => {
  it("maps countries with a positive ratio and skips zero/absent/invalid", () => {
    const map = buildMinWageRatioByCountry([
      { countryId: "US", minimumWageKaitzRatio: 0.5 },
      { countryId: "GB", minimumWageKaitzRatio: 0 },
      { countryId: "FR" }, // absent
      { countryId: "DE", minimumWageKaitzRatio: 2 }, // clamped to max
      { countryId: null, minimumWageKaitzRatio: 0.4 }, // no country → skipped
    ]);
    expect(map.get("US")).toBe(0.5);
    expect(map.has("GB")).toBe(false);
    expect(map.has("FR")).toBe(false);
    expect(map.get("DE")).toBe(MIN_WAGE_KAITZ_MAX);
    expect(map.size).toBe(2);
  });
});

describe("sectorWageLevel / SECTOR_WAGE_LEVEL", () => {
  it("decouples pay from labor intensity (retail: intensive yet low-paid)", () => {
    // Retail is more labor-INTENSIVE than extraction but PAID LESS per worker —
    // the decoupling that lets minimum wage bite the genuinely low-paid.
    expect(SECTOR_LABOR_INTENSITY.retail).toBeGreaterThan(SECTOR_LABOR_INTENSITY.extraction);
    expect(SECTOR_WAGE_LEVEL.retail).toBeLessThan(SECTOR_WAGE_LEVEL.extraction);
  });

  it("ranks pay sensibly (tech high, retail low) and falls back to the median", () => {
    expect(sectorWageLevel("technology")).toBeGreaterThan(sectorWageLevel("retail"));
    expect(sectorWageLevel("unknown_sector")).toBe(MEDIAN_SECTOR_WAGE_LEVEL);
  });
});

describe("getSectorLaborShare", () => {
  it("varies labor intensity by sector and era", () => {
    expect(getSectorLaborShare("technology", 2019)).toBeGreaterThan(
      getSectorLaborShare("real_estate", 2019)
    );
    expect(getSectorLaborShare("retail", 2019)).toBeCloseTo(SECTOR_LABOR_INTENSITY.retail, 9);
    expect(getSectorLaborShare("retail", 1979)).toBeCloseTo(
      SECTOR_LABOR_INTENSITY.retail * 1.25,
      9
    );
  });

  it("falls back to the default share for unknown sector types", () => {
    expect(getSectorLaborShare("nonexistent_sector", 2019)).toBeCloseTo(
      LABOUR_DEFAULT_LABOR_SHARE,
      9
    );
  });
});

describe("clampWageLevel", () => {
  it("clamps into [min, max] and maps non-finite to the default", () => {
    expect(clampWageLevel(1.0)).toBe(1.0);
    expect(clampWageLevel(0.5)).toBe(WAGE_LEVEL_MIN);
    expect(clampWageLevel(2.0)).toBe(WAGE_LEVEL_MAX);
    expect(clampWageLevel(Number.NaN)).toBe(WAGE_LEVEL_DEFAULT);
    expect(clampWageLevel(Number.POSITIVE_INFINITY)).toBe(WAGE_LEVEL_DEFAULT);
  });
});

describe("eraLaborMultiplier", () => {
  it("returns 1.0 when the year is unknown and steps up for older eras", () => {
    expect(eraLaborMultiplier(undefined)).toBe(1.0);
    expect(eraLaborMultiplier(2023)).toBe(1.0);
    expect(eraLaborMultiplier(1999)).toBe(1.1);
    expect(eraLaborMultiplier(1979)).toBe(1.25);
    expect(eraLaborMultiplier(1948)).toBe(1.35);
  });
});
