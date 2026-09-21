import { describe, expect, it } from "vitest";
import { PRODUCT_KINDS } from "./catalog";
import {
  manufacturingKindRequirements,
  manufacturingStrategyLabels,
  validateManufacturingProductStart,
} from "./manufacturing";

const AUTO_PLANT = { sectorType: "automobiles", strategyId: "standard", capacity: 100 };
const MFG_ELEC_PLANT = {
  sectorType: "manufacturing",
  strategyId: "electronics_manufacturing",
  capacity: 50,
};

describe("validateManufacturingProductStart", () => {
  it("accepts a compatible plant running a compatible process", () => {
    const result = validateManufacturingProductStart({
      kindId: "passenger_car",
      corporationTypes: ["automobiles"],
      plants: [AUTO_PLANT],
      currentYear: 2000,
    });
    expect(result).toMatchObject({ ok: true, sectorType: "automobiles", strategyId: "standard" });
  });

  it("rejects unknown and non-industrial kinds", () => {
    for (const kindId of ["bus", "film", "", "PASSENGER_CAR"]) {
      const result = validateManufacturingProductStart({
        kindId,
        corporationTypes: ["automobiles"],
        plants: [AUTO_PLANT],
        currentYear: 2000,
      });
      expect(result).toEqual({
        ok: false,
        reason: "unknown_product_kind",
        message: `Unknown industrial product "${kindId}"`,
      });
    }
  });

  it("rejects corporations of the wrong type", () => {
    const result = validateManufacturingProductStart({
      kindId: "passenger_car",
      corporationTypes: ["manufacturing"],
      plants: [AUTO_PLANT],
      currentYear: 2000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("incompatible_corporation_type");
      expect(result.message).toContain("automobiles");
    }
  });

  it("rejects missing, mothballed, and zero-capacity plants", () => {
    const cases = [
      [],
      [{ ...AUTO_PLANT, mothballed: true }],
      [{ ...AUTO_PLANT, capacity: 0 }],
      [{ ...AUTO_PLANT, capacity: -5 }],
      [{ sectorType: "manufacturing", strategyId: "standard", capacity: 100 }],
    ];
    for (const plants of cases) {
      const result = validateManufacturingProductStart({
        kindId: "passenger_car",
        corporationTypes: ["automobiles"],
        plants,
        currentYear: 2000,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("no_compatible_plant");
    }
  });

  it("rejects a plant running an incompatible process", () => {
    const result = validateManufacturingProductStart({
      kindId: "passenger_car",
      corporationTypes: ["automobiles"],
      plants: [{ ...AUTO_PLANT, strategyId: "heavy_machinery" }],
      currentYear: 2000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("incompatible_strategy");
      expect(result.message).toContain("standard");
    }
  });

  it("era-locks gated kinds before their decade", () => {
    const result = validateManufacturingProductStart({
      kindId: "consumer_electronics",
      corporationTypes: ["manufacturing"],
      plants: [MFG_ELEC_PLANT],
      currentYear: 1900,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("era_locked");
  });

  it("era-locks when the only compatible process is era-locked", () => {
    const result = validateManufacturingProductStart({
      kindId: "passenger_car",
      corporationTypes: ["automobiles"],
      plants: [{ ...AUTO_PLANT, strategyId: "autonomous_driving" }],
      currentYear: 2000,
      techTreesEnabled: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("era_locked");
  });

  it("fails closed on hostile input", () => {
    expect(
      validateManufacturingProductStart({
        kindId: 123 as unknown as string,
        corporationTypes: ["automobiles"],
        plants: [AUTO_PLANT],
        currentYear: 2000,
      }).ok
    ).toBe(false);
    const noTypes = validateManufacturingProductStart({
      kindId: "passenger_car",
      corporationTypes: undefined as unknown as string[],
      plants: [AUTO_PLANT],
      currentYear: 2000,
    });
    expect(noTypes.ok).toBe(false);
    const garbagePlants = validateManufacturingProductStart({
      kindId: "passenger_car",
      corporationTypes: ["automobiles"],
      plants: [{ sectorType: null, strategyId: [], capacity: NaN, mothballed: "yes" }],
      currentYear: 2000,
    });
    expect(garbagePlants.ok).toBe(false);
    if (!garbagePlants.ok) expect(garbagePlants.reason).toBe("no_compatible_plant");
    const noYear = validateManufacturingProductStart({
      kindId: "consumer_electronics",
      corporationTypes: ["manufacturing"],
      plants: [MFG_ELEC_PLANT],
      currentYear: NaN,
    });
    expect(noYear.ok).toBe(false);
    if (!noYear.ok) expect(noYear.reason).toBe("era_locked");
  });

  it("covers every industrial catalog kind with matching output", () => {
    const industrial = PRODUCT_KINDS.filter((kind) => kind.family === "industrial_manufacturing");
    expect(industrial.length).toBeGreaterThan(0);
    for (const kind of industrial) {
      const requirement = manufacturingKindRequirements(kind.id);
      expect(requirement).toBeDefined();
      expect(requirement?.outputCommodity).toBe(kind.outputCommodity);
      expect(manufacturingStrategyLabels(kind.id).length).toBeGreaterThan(0);
    }
    expect(manufacturingKindRequirements("nope")).toBeUndefined();
    expect(manufacturingStrategyLabels("nope")).toEqual([]);
  });
});
