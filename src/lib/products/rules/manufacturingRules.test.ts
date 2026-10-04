import { describe, expect, it } from "vitest";
import {
  advancePaidDevelopment,
  advanceManufacturingProject,
  allocateManufacturingResearchSpend,
  capManufacturingDevelopmentSpendToCash,
  allocateManufacturedOutput,
  buildManufacturedSectorOutput,
  productQualityForCommodity,
  resizeMeasuredManufacturedUnits,
  scaleManufacturedSectorOutput,
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

    expect(result.nominalOutputAnchorByCommodity.steel).toBeCloseTo(75);
    expect(result.nominalOutputAnchorByCommodity.building_materials).toBeCloseTo(75);
    expect(result.nominalOutputAnchorByCommodity.vehicles).toBeCloseTo(350);
    expect(Object.values(result.nominalOutputAnchorByCommodity).reduce((a, b) => a + b, 0)).toBe(
      500
    );
    expect(result.outputUnitsByCommodity.steel).toBeCloseTo(0.75);
    expect(result.outputUnitsByCommodity.building_materials).toBeCloseTo(1.5);
    expect(result.outputUnitsByCommodity.vehicles).toBeCloseTo(1.4);
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

  it("caps development spend at post-P&L cash and gives unfunded spend no credit", () => {
    expect(
      capManufacturingDevelopmentSpendToCash({
        proposedDevelopmentAnchor: 30,
        liquidCapitalAnchor: 100,
        incomeBeforeDevelopmentAnchor: -80,
      })
    ).toBe(20);
    expect(
      capManufacturingDevelopmentSpendToCash({
        proposedDevelopmentAnchor: 30,
        liquidCapitalAnchor: 0,
        incomeBeforeDevelopmentAnchor: -100,
      })
    ).toBe(0);
    expect(
      capManufacturingDevelopmentSpendToCash({
        proposedDevelopmentAnchor: 30,
        liquidCapitalAnchor: 100,
        incomeBeforeDevelopmentAnchor: -100,
      })
    ).toBe(0);
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
      1000,
      6
    );
    expect(output.outputAnchorByCommodity.steel).toBeCloseTo(325, 6);
    expect(output.outputAnchorByCommodity.building_materials).toBeCloseTo(325, 6);
    expect(output.outputAnchorByCommodity.vehicles).toBeCloseTo(350, 6);
    expect(output.productQualityByCommodity).toEqual({
      steel: 40,
      building_materials: 50,
      vehicles: 70,
    });
  });

  it("preserves the exact legacy mix and nominal value before development or at zero allocation", () => {
    const base = {
      outputAnchor: 10_000,
      supplyRates: { steel: 0.4, building_materials: 0.2 },
      stage: "development" as const,
      outputCommodity: "building_materials" as const,
      basePrices: { steel: 100, building_materials: 50 },
      paidDevelopmentAnchor: 0,
      paidThresholdAnchor: 1000,
    };
    const development = buildManufacturedSectorOutput({ ...base, allocationShare: 0.8 });
    const zeroAllocation = buildManufacturedSectorOutput({
      ...base,
      stage: "mature",
      allocationShare: 0,
    });

    expect(development.outputUnitsByCommodity).toEqual({ steel: 50, building_materials: 100 });
    expect(development.outputAnchorByCommodity).toEqual({ steel: 5000, building_materials: 5000 });
    expect(zeroAllocation.outputUnitsByCommodity).toEqual(development.outputUnitsByCommodity);
    expect(zeroAllocation.outputAnchorByCommodity).toEqual(development.outputAnchorByCommodity);
  });

  it("scales product quantity and nominal value by the same production factor at stage identity", () => {
    const baseline = buildManufacturedSectorOutput({
      outputAnchor: 10_000,
      supplyRates: { steel: 0.4, building_materials: 0.2 },
      allocationShare: 0,
      stage: "mature",
      outputCommodity: "vehicles",
      basePrices: { steel: 100, building_materials: 50, vehicles: 250 },
      paidDevelopmentAnchor: 1_000,
      paidThresholdAnchor: 1_000,
    });
    const scaled = scaleManufacturedSectorOutput(baseline, 0.6);

    expect(scaled.outputUnitsByCommodity).toEqual({ steel: 30, building_materials: 60 });
    expect(scaled.outputAnchorByCommodity).toEqual({ steel: 3_000, building_materials: 3_000 });
    for (const commodity of ["steel", "building_materials"] as const) {
      expect(
        scaled.outputAnchorByCommodity[commodity]! / scaled.outputUnitsByCommodity[commodity]!
      ).toBe(
        baseline.outputAnchorByCommodity[commodity]! / baseline.outputUnitsByCommodity[commodity]!
      );
    }
    expect(Object.values(scaled.outputAnchorByCommodity).reduce((a, b) => a + (b ?? 0), 0)).toBe(
      6_000
    );
    expect(
      Object.values(scaleManufacturedSectorOutput(baseline, 1.25).outputAnchorByCommodity).reduce(
        (a, b) => a + (b ?? 0),
        0
      )
    ).toBe(12_500);
  });

  it("resizes lagged realized throughput on today's producing capacity basis", () => {
    expect(
      resizeMeasuredManufacturedUnits({
        producedUnits: 130,
        currentCapacityUnits: 250,
        snapshotCapacityUnits: 200,
      })
    ).toBeCloseTo(162.5);
    expect(
      resizeMeasuredManufacturedUnits({
        producedUnits: 130,
        currentCapacityUnits: 150,
        snapshotCapacityUnits: 200,
      })
    ).toBeCloseTo(97.5);
    expect(
      resizeMeasuredManufacturedUnits({
        producedUnits: 250,
        currentCapacityUnits: 200,
        snapshotCapacityUnits: 100,
      })
    ).toBeCloseTo(500);
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
