import { describe, expect, it } from "vitest";
import {
  allocationsForPlantCapacity,
  isLegalManufacturingProductForPlant,
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
      sectorType: "manufacturing_vehicles",
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

  it("applies product-specific strategy compatibility", () => {
    const evPlant = { ...plants[1], strategyId: "ev" };
    const legal = legalManufacturingProductKinds([evPlant]);

    expect(legal.map((kind) => kind.id)).toContain("passenger_car");
    expect(legal.map((kind) => kind.id)).toContain("commercial_vehicle");
    expect(legal.map((kind) => kind.id)).not.toContain("truck");
  });

  it("keeps vehicle product eligibility after the model-aware 1991 taxonomy conversion", () => {
    const convertedVehiclePlant = {
      ...plants[1],
      sectorType: "manufacturing",
      industryModel: "vehicles" as const,
    };

    expect(isLegalManufacturingProductForPlant("passenger_car", convertedVehiclePlant)).toBe(true);
    expect(
      legalManufacturingProductKinds([convertedVehiclePlant]).map((kind) => kind.id)
    ).toContain("passenger_car");
    expect(
      legalManufacturingProductKinds([convertedVehiclePlant]).map((kind) => kind.id)
    ).not.toContain("structural_steel");
  });

  it("applies era and technology gates to the specific allocated vehicle plant", () => {
    const evPlant = {
      ...plants[1],
      sectorType: "manufacturing",
      industryModel: "vehicles" as const,
      strategyId: "ev",
    };

    expect(
      legalManufacturingProductKinds([evPlant], {
        currentYear: 1953,
        techTreesEnabled: true,
        unlockedTechNodeIds: [],
      })
    ).toEqual([]);
    expect(
      isLegalManufacturingProductForPlant("passenger_car", evPlant, {
        currentYear: 1953,
        techTreesEnabled: true,
        unlockedTechNodeIds: [],
      })
    ).toBe(false);
  });
});
