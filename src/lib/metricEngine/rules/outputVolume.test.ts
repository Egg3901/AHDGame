import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { describe, expect, it } from "vitest";
import { constantPriceOutput, sumObservedOutput } from "./outputVolume";

describe("constant-price production", () => {
  it.each(CORPORATION_TYPES)("supports the canonical production basket for %s", (sectorType) => {
    const value = constantPriceOutput({ sectorType, producedUnits: 100 }, 48);
    expect(value).not.toBeNull();
    expect(value).toBeGreaterThan(0);
    expect(constantPriceOutput({ sectorType, producedUnits: 50 }, 48)).toBeCloseTo(value! / 2);
  });

  it("values physical quantities without income, market prices or currency inputs", () => {
    const base = { sectorType: "manufacturing" as const, producedUnits: 100 };
    const value = constantPriceOutput(base, 48)!;
    expect(value).toBeGreaterThan(0);
    expect(constantPriceOutput({ ...base, producedUnits: 95 }, 48)).toBeCloseTo(value * 0.95);
    expect(constantPriceOutput({ ...base, producedUnits: 0 }, 48)).toBe(0);
  });

  it.each([undefined, NaN, Infinity, -1])("rejects missing or invalid production %s", (units) => {
    expect(
      constantPriceOutput({ sectorType: "manufacturing", producedUnits: units }, 48)
    ).toBeNull();
  });

  it("requires a complete observation but accepts an observed shutdown", () => {
    expect(sumObservedOutput([])).toBeNull();
    expect(sumObservedOutput([{ outputVolume: 100 }, {}])).toBeNull();
    expect(sumObservedOutput([{ outputVolume: 100 }, { outputVolume: NaN }])).toBeNull();
    expect(sumObservedOutput([{ outputVolume: 100 }, { outputVolume: 0 }])).toBe(100);
    expect(sumObservedOutput([{ outputVolume: 0 }])).toBe(0);
  });
});
