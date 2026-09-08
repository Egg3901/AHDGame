import { describe, expect, it } from "vitest";
import { capacityRescaleRatio } from "@/lib/constants/capacityEconomy";
import { retoolOperatingCapacityRatio, retoolProductionMeasurements } from "./rules";

const transition = {
  sectorType: "extraction" as const,
  strategyId: "coal_mining",
  transitionFromStrategyId: "rare_earth_mining",
  transitionStartTurn: 100,
  retoolRescaleApplied: true,
};

describe("retool production basis", () => {
  it("does not reinterpret legacy unconverted stock or a completed recipe", () => {
    expect(
      retoolOperatingCapacityRatio({ ...transition, retoolRescaleApplied: false, currentTurn: 101 })
    ).toBe(1);
    expect(retoolOperatingCapacityRatio({ ...transition, currentTurn: 112 })).toBe(1);
  });

  it("changes the unit count at the retool boundary without changing value", () => {
    const ratio = retoolOperatingCapacityRatio({ ...transition, currentTurn: 100 });
    const stockRatio = capacityRescaleRatio("extraction", "rare_earth_mining", "coal_mining");
    expect(stockRatio * ratio).toBeCloseTo(1, 12);
    expect(
      retoolProductionMeasurements({
        ...transition,
        currentTurn: 100,
        operatingCapacityTurn: 99,
        producedUnits: 50,
      })
    ).toEqual({});
  });

  it("converts lagged sales once and preserves utilization and fill", () => {
    const input = {
      ...transition,
      currentTurn: 106,
      operatingCapacityTurn: 105,
      operatingCapacityUnits: 200,
      producedUnits: 100,
      soldUnits: 60,
      contractAchievableUnits: 150,
    };
    const converted = retoolProductionMeasurements(input);
    expect(converted.producedUnits! / converted.operatingCapacityUnits!).toBeCloseTo(0.5, 12);
    expect(converted.soldUnits! / converted.producedUnits!).toBeCloseTo(0.6, 12);
    expect(converted.contractAchievableUnits! / converted.producedUnits!).toBeCloseTo(1.5, 12);
    expect(converted.operatingCapacityTurn).toBe(106);
    expect(retoolProductionMeasurements({ ...input, ...converted })).toEqual({});
    expect(input.producedUnits).toBe(100);
  });

  it("recovers an old in-flight measurement that used destination units", () => {
    const ratio = retoolOperatingCapacityRatio({ ...transition, currentTurn: 106 });
    const converted = retoolProductionMeasurements({
      ...transition,
      currentTurn: 106,
      capitalStock: 200,
      producedUnits: 100,
    });
    expect(converted.operatingCapacityUnits).toBeCloseTo(200 * ratio, 12);
    expect(converted.producedUnits).toBeCloseTo(100 * ratio, 12);
  });
});
