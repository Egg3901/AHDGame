import { describe, expect, it } from "vitest";
import { advancePlantLedger, seedPlantLedger, splitWholePlantCount } from "./plantLedger";

describe("seedPlantLedger", () => {
  it("matches the existing whole-facility presentation without changing stock", () => {
    expect(seedPlantLedger("energy", 999)).toEqual({
      plantCount: 3,
      plantUnitRemainder: 249,
    });
    expect(seedPlantLedger("energy", 12)).toEqual({
      plantCount: 1,
      plantUnitRemainder: 0,
    });
    expect(seedPlantLedger("energy", 0)).toEqual({
      plantCount: 0,
      plantUnitRemainder: 0,
    });
  });
});

describe("advancePlantLedger", () => {
  it("combines fractional deliveries into whole plants", () => {
    const first = advancePlantLedger({
      sectorType: "energy",
      plantCount: 10,
      plantUnitRemainder: 200,
      currentCapitalStock: 0,
      deliveredUnits: 100,
    });
    expect(first).toEqual({ plantCount: 11, plantUnitRemainder: 50 });

    const second = advancePlantLedger({
      sectorType: "energy",
      ...first,
      currentCapitalStock: 0,
      deliveredUnits: 450,
    });
    expect(second).toEqual({ plantCount: 13, plantUnitRemainder: 0 });
  });

  it("self-seeds rows that missed the migration", () => {
    expect(
      advancePlantLedger({
        sectorType: "retail",
        plantCount: undefined,
        plantUnitRemainder: undefined,
        currentCapitalStock: 800,
        deliveredUnits: 80,
      })
    ).toEqual({ plantCount: 11, plantUnitRemainder: 0 });
  });
});

describe("splitWholePlantCount", () => {
  it("allocates only whole plants and conserves the opening count", () => {
    expect(splitWholePlantCount(101, 0.25)).toEqual({ carved: 25, kept: 76 });
    expect(splitWholePlantCount(3, 0.1)).toEqual({ carved: 1, kept: 2 });
    expect(splitWholePlantCount(3, 0)).toEqual({ carved: 0, kept: 3 });
    expect(splitWholePlantCount(3, 1)).toEqual({ carved: 3, kept: 0 });
  });
});
