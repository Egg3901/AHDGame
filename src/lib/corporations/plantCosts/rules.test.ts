import { describe, expect, it } from "vitest";
import { PLANT_OVERHEAD_FIXED_SHARE, computePlantOverhead } from "./rules";

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
