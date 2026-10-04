import { describe, expect, it } from "vitest";
import {
  allocationsForPlantCapacity,
  legalManufacturingProductKinds,
  validateProductAllocations,
} from "./manufacturingEligibility";

describe("manufacturing product eligibility", () => {
  const plants = [
    {
      sectorId: "steel-1",
      corporationId: "corp-1",
      sectorType: "manufacturing",
      strategyId: "standard",
      capitalStock: 500,
      plantCount: 2,
      mothballed: false,
    },
    {
      sectorId: "auto-1",
      corporationId: "corp-1",
      sectorType: "automobiles",
      strategyId: "standard",
      capitalStock: 250,
      plantCount: 1,
      mothballed: false,
    },
  ];

  it("offers only commodities produced by an owned, active plant's current strategy", () => {
    expect(legalManufacturingProductKinds(plants).map((kind) => kind.outputCommodity)).toContain(
      "vehicles"
    );
    expect(legalManufacturingProductKinds(plants).map((kind) => kind.outputCommodity)).toContain(
      "steel"
    );
    expect(
      legalManufacturingProductKinds(plants.slice(1)).map((kind) => kind.outputCommodity)
    ).not.toContain("building_materials");
  });

  it("rejects duplicate plants and combined allocations above one", () => {
    expect(
      validateProductAllocations([
        { sectorId: "steel-1", share: 0.7 },
        { sectorId: "steel-1", share: 0.4 },
      ])
    ).toBe(false);
    expect(validateProductAllocations([{ sectorId: "steel-1", share: 1.01 }])).toBe(false);
  });

  it("allocates capital stock rather than an invented capacity field", () => {
    expect(allocationsForPlantCapacity(plants, [{ sectorId: "steel-1", share: 0.5 }])).toEqual([
      { sectorId: "steel-1", capacityStock: 250, share: 0.5 },
    ]);
  });
});
