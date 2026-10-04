import { describe, expect, it } from "vitest";
import { computePlantOverhead } from "./rules";

const base = {
  nominalDailyRevenue: 240_000,
  capacity: 1000,
  producedUnits: 800,
  turnsPerDay: 24,
  mothballed: false,
};

describe("explicit plant overhead", () => {
  it("scales with actual production and era price level", () => {
    expect(computePlantOverhead(base)).toBe(320);
    expect(computePlantOverhead({ ...base, producedUnits: 400 })).toBe(160);
    expect(computePlantOverhead({ ...base, nominalDailyRevenue: 480_000 })).toBe(640);
    expect(computePlantOverhead({ ...base, capacity: 2000, nominalDailyRevenue: 480_000 })).toBe(
      320
    );
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
