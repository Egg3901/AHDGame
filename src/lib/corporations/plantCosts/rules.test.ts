import { describe, expect, it } from "vitest";
import { PLANT_OVERHEAD_FIXED_SHARE, computePlantOverhead, plantLaborShare } from "./rules";
import { getSectorLaborShare } from "@/lib/labour/laborCost";

describe("explicit production-method payroll", () => {
  const args = { sectorType: "technology", strategyId: "hardware", currentTurn: 100, year: 1991 };

  it.each([
    [1953, 0.375],
    [1991, 0.33],
    [2027, 0.3],
  ])("restores hardware intensity in %s", (year, expected) => {
    expect(plantLaborShare({ ...args, year })).toBeCloseTo(expected, 12);
  });

  it("retains the service setting and other industries", () => {
    for (const strategyId of [
      undefined,
      "standard",
      "software",
      "quantum_computing",
      "ai_platforms",
    ])
      expect(plantLaborShare({ ...args, strategyId })).toBe(
        getSectorLaborShare("technology", 1991)
      );
    expect(plantLaborShare({ ...args, sectorType: "manufacturing" })).toBe(
      getSectorLaborShare("manufacturing", 1991)
    );
  });

  it.each([
    ["software", "hardware", 100, 0.44],
    ["software", "hardware", 106, 0.385],
    ["software", "hardware", 112, 0.33],
    ["hardware", "software", 100, 0.33],
    ["hardware", "software", 106, 0.385],
    ["hardware", "software", 112, 0.44],
    ["hardware", "software", 99, 0.33],
    ["hardware", "software", 113, 0.44],
  ])(
    "blends %s to %s at turn %s",
    (transitionFromStrategyId, strategyId, currentTurn, expected) => {
      expect(
        plantLaborShare({
          ...args,
          transitionFromStrategyId,
          strategyId,
          currentTurn,
          transitionStartTurn: 100,
        })
      ).toBeCloseTo(expected, 12);
    }
  );

  it("uses the target when transition metadata is incomplete", () => {
    expect(plantLaborShare({ ...args, transitionFromStrategyId: "software" })).toBeCloseTo(0.33);
    expect(plantLaborShare({ ...args, transitionStartTurn: 99 })).toBeCloseTo(0.33);
  });
});

const base = {
  nominalDailyRevenue: 240_000,
  capacity: 1000,
  producedUnits: 800,
  turnsPerDay: 24,
  mothballed: false,
};

describe("explicit plant overhead", () => {
  it("bills a fully running plant exactly the old per-unit rate", () => {
    expect(computePlantOverhead({ ...base, producedUnits: 1000 })).toBe(400);
    expect(
      computePlantOverhead({ ...base, producedUnits: 1000, nominalDailyRevenue: 480_000 })
    ).toBe(800);
  });

  it("keeps the fixed half when the plant runs below capacity", () => {
    // 800 of 1000 units: half billed on output (400), half on capacity (500).
    expect(PLANT_OVERHEAD_FIXED_SHARE).toBe(0.5);
    expect(computePlantOverhead(base)).toBe(360);
    // At 40% utilization the bill falls only 30%, not 60%.
    expect(computePlantOverhead({ ...base, producedUnits: 400 })).toBe(280);
  });

  it("is fixed to the nominal basket, so the era price level scales it", () => {
    expect(computePlantOverhead({ ...base, nominalDailyRevenue: 480_000 })).toBe(720);
  });

  it("bills the fixed half on active capacity only", () => {
    // 400 produced, 500 active: 200 + 250 = 450 billed units.
    expect(computePlantOverhead({ ...base, activeFraction: 0.5, producedUnits: 400 })).toBe(180);
    expect(computePlantOverhead({ ...base, activeFraction: Number.NaN })).toBe(360);
  });

  it("never turns missing, invalid or cold capacity into a credit", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(computePlantOverhead({ ...base, capacity: bad })).toBe(0);
      expect(computePlantOverhead({ ...base, nominalDailyRevenue: bad })).toBe(0);
      expect(computePlantOverhead({ ...base, producedUnits: bad })).toBe(0);
    }
    expect(computePlantOverhead({ ...base, mothballed: true })).toBe(0);
  });
});
