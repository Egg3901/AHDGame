import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { describe, expect, it } from "vitest";
import {
  constantPriceOutput,
  sumObservedOutput,
  blendOutputGrowthSignal,
  outputHistorySpanTurns,
} from "./outputVolume";

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

describe("physical measurement transition", () => {
  it("ends the handoff permanently despite nearest-year baseline oscillation", () => {
    const snapshots = Array.from({ length: 7 }, (_, index) => ({ turn: index * 8, value: 100 }));
    for (let turn = 48; turn < 56; turn++) {
      expect(blendOutputGrowthSignal(10, 0, outputHistorySpanTurns(snapshots, turn))).toBe(0);
    }
  });

  it("bridges both inflated and deflated prior signals without overriding output afterward", () => {
    for (const prior of [-10, 15]) {
      expect(blendOutputGrowthSignal(prior, 0, 8)).toBe(prior);
      expect(blendOutputGrowthSignal(prior, 0, 28)).toBe(prior / 2);
      expect(blendOutputGrowthSignal(prior, -5, 48)).toBe(-5);
      expect(blendOutputGrowthSignal(prior, null, 48)).toBe(prior);
    }
  });
});
