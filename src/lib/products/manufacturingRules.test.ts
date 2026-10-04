import { describe, expect, it } from "vitest";
import {
  advancePaidDevelopment,
  advanceManufacturingProject,
  allocateManufacturingResearchSpend,
  allocateManufacturedOutput,
  buildManufacturedSectorOutput,
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

  it("redirects paid R&D dollar for dollar until one project's remaining cost is paid", () => {
    expect(
      allocateManufacturingResearchSpend({
        paidResearchAnchor: 35,
        projectPaidAnchor: 90,
        projectCostAnchor: 100,
        stage: "development",
      })
    ).toEqual({ productDevelopmentAnchor: 10, genericResearchAnchor: 25 });
    expect(
      allocateManufacturingResearchSpend({
        paidResearchAnchor: 35,
        projectPaidAnchor: 0,
        projectCostAnchor: 100,
        stage: "launch",
      })
    ).toEqual({ productDevelopmentAnchor: 0, genericResearchAnchor: 35 });
  });

  it("applies one matching paid receipt once and advances only after both thresholds", () => {
    const project = {
      _id: "project-1",
      stage: "development" as const,
      stageStartedTurn: 10,
      startedTurn: 10,
      lastProcessedTurn: 10,
      developmentPaidAnchor: 80,
      paidThresholdAnchor: 100,
      elapsedDevelopmentTurns: 1,
      elapsedThresholdTurns: 2,
    };

    const progress = advanceManufacturingProject({
      project,
      receipt: { projectId: "project-1", turn: 11, amountAnchor: 20 },
    });

    expect(progress).toEqual({
      stage: "launch",
      stageStartedTurn: 11,
      lastProcessedTurn: 11,
      developmentPaidAnchor: 100,
      elapsedDevelopmentTurns: 2,
      active: true,
    });
    expect(
      advanceManufacturingProject({
        project: { ...project, lastProcessedTurn: 11 },
        receipt: { projectId: "project-1", turn: 11, amountAnchor: 20 },
      })
    ).toBeNull();
  });

  it("does not let an old project receipt fund a replacement project", () => {
    const progress = advanceManufacturingProject({
      project: {
        _id: "project-new",
        stage: "development",
        stageStartedTurn: 20,
        startedTurn: 20,
        developmentPaidAnchor: 0,
        paidThresholdAnchor: 100,
        elapsedDevelopmentTurns: 0,
        elapsedThresholdTurns: 2,
      },
      receipt: { projectId: "project-old", turn: 19, amountAnchor: 100 },
    });

    expect(progress).toBeNull();
  });

  it("retires a mature product after its decline receipts", () => {
    const progress = advanceManufacturingProject({
      project: {
        _id: "project-1",
        stage: "decline",
        stageStartedTurn: 30,
        startedTurn: 1,
        lastProcessedTurn: 88,
        developmentPaidAnchor: 100,
        paidThresholdAnchor: 100,
        elapsedDevelopmentTurns: 2,
        elapsedThresholdTurns: 2,
      },
      receipt: { projectId: "project-1", turn: 89, amountAnchor: 0 },
    });
    expect(progress?.stage).toBe("retired");
    expect(progress?.active).toBe(false);
  });

  it("keeps the whole sector nominal output value while redirecting only allocated capacity", () => {
    const output = buildManufacturedSectorOutput({
      outputAnchor: 1000,
      supplyRates: { steel: 0.4, building_materials: 0.2 },
      allocationShare: 0.5,
      stage: "mature",
      outputCommodity: "vehicles",
      basePrices: { steel: 100, building_materials: 50, vehicles: 250 },
      paidDevelopmentAnchor: 1000,
      paidThresholdAnchor: 1000,
      currentSectorQualityByCommodity: { steel: 40, building_materials: 50, vehicles: 60 },
    });

    expect(Object.values(output.outputAnchorByCommodity).reduce((a, b) => a + b, 0)).toBeCloseTo(
      600,
      6
    );
    expect(output.outputAnchorByCommodity.steel).toBeCloseTo(260, 6);
    expect(output.outputAnchorByCommodity.building_materials).toBeCloseTo(130, 6);
    expect(output.outputAnchorByCommodity.vehicles).toBeCloseTo(210, 6);
    expect(output.productQualityByCommodity).toEqual({
      steel: 40,
      building_materials: 50,
      vehicles: 70,
    });
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
