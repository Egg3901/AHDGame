import { describe, expect, it } from "vitest";
import { chooseNppManufacturingProduct } from "./rules/manufacturingNpp";
import {
  advanceManufacturingProject,
  allocateManufacturedOutput,
  allocateManufacturingResearchSpend,
  buildManufacturedSectorOutput,
  manufacturingDevelopmentThresholdAnchor,
  MANUFACTURING_DEVELOPMENT_ELAPSED_TURNS,
} from "./rules/manufacturingRules";

const CAPITAL_STOCK = 100_000;
const PROJECT_COST = manufacturingDevelopmentThresholdAnchor(CAPITAL_STOCK);
const BASELINE = {
  outputAnchor: 100_000,
  supplyRates: { steel: 0.4, building_materials: 0.2 },
  allocationShare: 0.5,
  outputCommodity: "vehicles" as const,
  basePrices: { steel: 100, building_materials: 50, vehicles: 250 },
};

function initialProject() {
  return {
    _id: "product-1",
    stage: "development" as const,
    stageStartedTurn: 1,
    startedTurn: 1,
    lastProcessedTurn: 0,
    developmentPaidAnchor: 0,
    paidThresholdAnchor: PROJECT_COST,
    elapsedDevelopmentTurns: 0,
    elapsedThresholdTurns: MANUFACTURING_DEVELOPMENT_ELAPSED_TURNS,
  };
}

describe("manufacturing product line balance evidence", () => {
  it("sets the development threshold to 5% of allocated physical capital stock", () => {
    expect(PROJECT_COST).toBe(5_000);
    expect(manufacturingDevelopmentThresholdAnchor(10)).toBe(1);
    expect(MANUFACTURING_DEVELOPMENT_ELAPSED_TURNS).toBe(12);
  });

  it("requires both 5,000 paid and 12 elapsed receipts before launch", () => {
    let project = initialProject();
    let developmentCash = 0;
    let genericResearchCash = 0;
    const paidPerTurn = 500;

    for (let turn = 1; turn <= 12; turn += 1) {
      const spend = allocateManufacturingResearchSpend({
        paidResearchAnchor: paidPerTurn,
        projectPaidAnchor: project.developmentPaidAnchor,
        projectCostAnchor: PROJECT_COST,
        stage: project.stage,
      });
      developmentCash += spend.productDevelopmentAnchor;
      genericResearchCash += spend.genericResearchAnchor;
      const next = advanceManufacturingProject({
        project,
        receipt: {
          projectId: project._id,
          turn,
          amountAnchor: spend.productDevelopmentAnchor,
        },
      });
      expect(next).not.toBeNull();
      project = { ...project, ...next! };
      if (turn === 10) expect(project.stage).toBe("development");
      if (turn === 11) expect(project.stage).toBe("development");
    }

    expect(developmentCash).toBe(PROJECT_COST);
    expect(genericResearchCash).toBe(1_000);
    expect(project.stage).toBe("launch");
    expect(project.lastProcessedTurn).toBe(12);
  });

  it("keeps an unfunded project in development despite 12 elapsed turns", () => {
    let project = initialProject();
    for (let turn = 1; turn <= 12; turn += 1) {
      const spend = allocateManufacturingResearchSpend({
        paidResearchAnchor: 0,
        projectPaidAnchor: project.developmentPaidAnchor,
        projectCostAnchor: PROJECT_COST,
        stage: project.stage,
      });
      const next = advanceManufacturingProject({
        project,
        receipt: { projectId: project._id, turn, amountAnchor: spend.productDevelopmentAnchor },
      });
      expect(next).not.toBeNull();
      project = { ...project, ...next! };
    }
    expect(project.elapsedDevelopmentTurns).toBe(12);
    expect(project.developmentPaidAnchor).toBe(0);
    expect(project.stage).toBe("development");
  });

  it("simulates the full lifecycle with conserved daily recipe value", () => {
    const redirectedByStage = {
      development: 0,
      launch: 7_500,
      growth: 20_000,
      mature: 35_000,
      decline: 20_000,
      retired: 0,
    } as const;
    let project = {
      ...initialProject(),
      stage: "launch" as const,
      stageStartedTurn: 12,
      lastProcessedTurn: 12,
      developmentPaidAnchor: PROJECT_COST,
      elapsedDevelopmentTurns: 12,
    };
    const transitions: Array<{ turn: number; stage: string }> = [{ turn: 12, stage: "launch" }];

    for (let turn = 13; turn <= 260; turn += 1) {
      const next = advanceManufacturingProject({
        project,
        receipt: { projectId: project._id, turn, amountAnchor: 0 },
      });
      expect(next).not.toBeNull();
      project = { ...project, ...next! };
      if (project.stage !== transitions.at(-1)?.stage) {
        transitions.push({ turn, stage: project.stage });
      }
    }

    expect(transitions).toEqual([
      { turn: 12, stage: "launch" },
      { turn: 35, stage: "growth" },
      { turn: 82, stage: "mature" },
      { turn: 201, stage: "decline" },
      { turn: 260, stage: "retired" },
    ]);

    for (const [stage, expectedProductValue] of Object.entries(redirectedByStage)) {
      const output = buildManufacturedSectorOutput({
        ...BASELINE,
        stage: stage as keyof typeof redirectedByStage,
        paidDevelopmentAnchor: PROJECT_COST,
        paidThresholdAnchor: PROJECT_COST,
        currentSectorQualityByCommodity: { steel: 40, building_materials: 50, vehicles: 60 },
      });
      const dayValue = Object.values(output.outputAnchorByCommodity).reduce(
        (sum, value) => sum + (value ?? 0),
        0
      );
      expect(dayValue).toBeCloseTo(100_000, 6);
      expect(output.outputAnchorByCommodity.vehicles ?? 0).toBeCloseTo(expectedProductValue, 6);
    }

    const matureOutput = allocateManufacturedOutput({
      ...BASELINE,
      stage: "mature",
    });
    expect(matureOutput.inputThroughputShare).toBe(0.5);
    expect(
      Object.values(matureOutput.nominalOutputAnchorByCommodity).reduce((a, b) => a + b, 0)
    ).toBeCloseTo(50_000, 6);
  });

  it("chooses NPP projects from actual margin, scarcity, and strategy mix exposure", () => {
    const candidate = (
      kindId: string,
      capacityWeightedMarginPct: number,
      scarcityPriceRatio: number,
      supplyMixWeight: number
    ) => ({
      kindId,
      outputCommodity: "steel" as const,
      allocations: [{ sectorId: "plant", share: 1 }],
      capacityStock: CAPITAL_STOCK,
      capacityWeightedMarginPct,
      scarcityPriceRatio,
      supplyMixWeight,
    });
    const recipeWeighted = candidate("steel", 30, 1.5, 0.8);
    const barelyProduced = candidate("electronics", 35, 1.8, 0.1);

    expect(chooseNppManufacturingProduct([barelyProduced, recipeWeighted])).toBe(recipeWeighted);
  });
});
