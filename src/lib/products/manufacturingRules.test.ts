import { describe, expect, it } from "vitest";
import {
  advancePaidDevelopment,
  allocateManufacturedOutput,
  productQualityForCommodity,
} from "./manufacturingRules";

describe("manufacturing product line rules", () => {
  it("conserves nominal recipe output value while redirecting to one commodity", () => {
    const result = allocateManufacturedOutput({
      outputAnchor: 1000,
      supplyRates: { steel: 0.4, building_materials: 0.2 },
      allocationShare: 0.5,
      stage: "mature",
      outputCommodity: "vehicles",
      basePrices: { steel: 100, building_materials: 50, vehicles: 250 },
    });

    expect(result.nominalOutputAnchorByCommodity.steel).toBe(60);
    expect(result.nominalOutputAnchorByCommodity.building_materials).toBe(30);
    expect(result.nominalOutputAnchorByCommodity.vehicles).toBeCloseTo(210);
    expect(Object.values(result.nominalOutputAnchorByCommodity).reduce((a, b) => a + b, 0)).toBe(
      300
    );
    expect(result.outputUnitsByCommodity.steel).toBe(0.6);
    expect(result.outputUnitsByCommodity.building_materials).toBe(0.6);
    expect(result.outputUnitsByCommodity.vehicles).toBeCloseTo(0.84);
    expect(result.inputThroughputShare).toBe(0.5);
  });

  it("does not advance stage until both paid and elapsed thresholds are met", () => {
    expect(
      advancePaidDevelopment({
        currentPaidAnchor: 600,
        additionalPaidAnchor: 0,
        elapsedTurns: 3,
        paidThresholdAnchor: 1000,
        elapsedThresholdTurns: 2,
      })
    ).toEqual({ paidAnchor: 600, elapsedTurns: 3, ready: false });
    expect(
      advancePaidDevelopment({
        currentPaidAnchor: 600,
        additionalPaidAnchor: 400,
        elapsedTurns: 3,
        paidThresholdAnchor: 1000,
        elapsedThresholdTurns: 2,
      })
    ).toEqual({ paidAnchor: 1000, elapsedTurns: 3, ready: true });
  });

  it("uses live commodity quality and only a bounded paid-development contribution", () => {
    expect(
      productQualityForCommodity({
        currentSectorQuality: 65,
        paidDevelopmentAnchor: 10000,
        paidThresholdAnchor: 1000,
        stage: "growth",
      })
    ).toBeLessThanOrEqual(75);
    expect(
      productQualityForCommodity({
        currentSectorQuality: 65,
        paidDevelopmentAnchor: 0,
        paidThresholdAnchor: 1000,
        stage: "growth",
      })
    ).toBe(65);
  });
});
