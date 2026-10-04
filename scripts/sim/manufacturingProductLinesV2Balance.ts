import {
  advanceManufacturingProject,
  allocateManufacturedOutput,
  allocateManufacturingResearchSpend,
  buildManufacturedSectorOutput,
  manufacturingDevelopmentThresholdAnchor,
  scaleManufacturedSectorOutput,
  MANUFACTURING_DEVELOPMENT_ELAPSED_TURNS,
  type ManufacturingLifecycleStage,
} from "../../src/lib/products/rules/manufacturingRules";
import { chooseNppManufacturingProduct } from "../../src/lib/products/rules/manufacturingNpp";
import { COMMODITY_BASE_PRICES, type CommodityType } from "../../src/lib/constants/commodities";
import { computeClearingFactors } from "../../src/lib/market/clearing";

const allocatedCapitalStock = 100_000;
const projectCost = manufacturingDevelopmentThresholdAnchor(allocatedCapitalStock);
const basePrices = { steel: 100, building_materials: 50, vehicles: 250 };
const balanceBasePrices = { ...COMMODITY_BASE_PRICES, ...basePrices };
const supplyRates = { steel: 0.4, building_materials: 0.2 };
const allocatedShare = 0.5;
const stages: ManufacturingLifecycleStage[] = [
  "development",
  "launch",
  "growth",
  "mature",
  "decline",
  "retired",
];

function money(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function simulateDevelopment(paidResearchPerTurn: number) {
  let project = {
    _id: `balance-${paidResearchPerTurn}`,
    stage: "development" as ManufacturingLifecycleStage,
    stageStartedTurn: 1,
    startedTurn: 1,
    lastProcessedTurn: 0,
    developmentPaidAnchor: 0,
    paidThresholdAnchor: projectCost,
    elapsedDevelopmentTurns: 0,
    elapsedThresholdTurns: MANUFACTURING_DEVELOPMENT_ELAPSED_TURNS,
  };
  let paidDevelopment = 0;
  let genericResearch = 0;
  let launchTurn: number | null = null;

  for (let turn = 1; turn <= MANUFACTURING_DEVELOPMENT_ELAPSED_TURNS; turn += 1) {
    const spend = allocateManufacturingResearchSpend({
      paidResearchAnchor: paidResearchPerTurn,
      projectPaidAnchor: project.developmentPaidAnchor,
      projectCostAnchor: projectCost,
      stage: project.stage,
    });
    paidDevelopment += spend.productDevelopmentAnchor;
    genericResearch += spend.genericResearchAnchor;
    const progress = advanceManufacturingProject({
      project,
      receipt: {
        projectId: project._id,
        turn,
        amountAnchor: spend.productDevelopmentAnchor,
      },
    });
    if (!progress) throw new Error(`Expected a valid receipt at turn ${turn}`);
    project = { ...project, ...progress };
    if (project.stage === "launch" && launchTurn == null) launchTurn = turn;
  }

  return { paidDevelopment, genericResearch, project, launchTurn };
}

const funded = simulateDevelopment(500);
const unfunded = simulateDevelopment(0);
const outputByStage = stages.map((stage) => {
  const output = buildManufacturedSectorOutput({
    outputAnchor: allocatedCapitalStock,
    supplyRates,
    allocationShare: allocatedShare,
    stage,
    outputCommodity: "vehicles",
    basePrices,
    paidDevelopmentAnchor: projectCost,
    paidThresholdAnchor: projectCost,
    currentSectorQualityByCommodity: {
      steel: 40,
      building_materials: 50,
      vehicles: 60,
    },
  });
  const nominalValue = Object.values(output.outputAnchorByCommodity).reduce(
    (sum, value) => sum + (value ?? 0),
    0
  );
  const balances = new Map<CommodityType, { supply: number; demand: number }>();
  const priceRatios = new Map<CommodityType, number>();
  for (const [commodity, units] of Object.entries(output.outputUnitsByCommodity) as Array<
    [CommodityType, number]
  >) {
    balances.set(commodity, { supply: units, demand: units * 0.8 });
    priceRatios.set(commodity, 1);
  }
  const clearing = computeClearingFactors({
    sectors: [
      {
        sectorId: "balance-plant",
        revenue: nominalValue,
        supplyRates: Object.fromEntries(
          Object.keys(output.outputUnitsByCommodity).map((commodity) => [commodity, 1])
        ),
        outputUnitsByCommodity: output.outputUnitsByCommodity,
        outputAnchorByCommodity: output.outputAnchorByCommodity,
        productQualityByCommodity: output.productQualityByCommodity,
        projectOutputUnitsByCommodity: output.projectOutputUnitsByCommodity,
        productProjectId: "balance-project",
        productOutputTurn: 1,
        posture: 0,
      },
    ],
    balances,
    priceRatioByCommodity: priceRatios,
    basePrices: balanceBasePrices,
    plantsEnabled: true,
  }).get("balance-plant");
  if (!clearing) throw new Error(`Expected a clearing result for ${stage}`);
  const totalSalesCash = nominalValue * clearing.factor;
  const productSalesCash = Object.entries(clearing.projectSoldUnitsByCommodity ?? {}).reduce(
    (sum, [commodity, units]) => {
      const key = commodity as CommodityType;
      return (
        sum + (units ?? 0) * balanceBasePrices[key] * (clearing.offerFactorByCommodity?.[key] ?? 1)
      );
    },
    0
  );
  return {
    stage,
    productValue: output.outputAnchorByCommodity.vehicles ?? 0,
    otherValue: nominalValue - (output.outputAnchorByCommodity.vehicles ?? 0),
    nominalValue,
    quality: output.productQualityByCommodity.vehicles,
    totalSalesCash,
    productSalesCash,
  };
});
const allocatedPlantOutput = allocateManufacturedOutput({
  outputAnchor: allocatedCapitalStock,
  supplyRates,
  allocationShare: allocatedShare,
  stage: "mature",
  outputCommodity: "vehicles",
  basePrices,
});
const allocatedPlantValue = Object.values(
  allocatedPlantOutput.nominalOutputAnchorByCommodity
).reduce((sum, value) => sum + (value ?? 0), 0);

let lifecycleProject = {
  _id: "balance-lifecycle",
  stage: "launch" as ManufacturingLifecycleStage,
  stageStartedTurn: 12,
  startedTurn: 1,
  lastProcessedTurn: 12,
  developmentPaidAnchor: projectCost,
  paidThresholdAnchor: projectCost,
  elapsedDevelopmentTurns: 12,
  elapsedThresholdTurns: MANUFACTURING_DEVELOPMENT_ELAPSED_TURNS,
};
const lifecycleTransitions: Array<{ turn: number; stage: ManufacturingLifecycleStage }> = [
  { turn: 12, stage: "launch" },
];
for (let turn = 13; turn <= 260; turn += 1) {
  const progress = advanceManufacturingProject({
    project: lifecycleProject,
    receipt: { projectId: lifecycleProject._id, turn, amountAnchor: 0 },
  });
  if (!progress) throw new Error(`Expected a valid lifecycle receipt at turn ${turn}`);
  lifecycleProject = { ...lifecycleProject, ...progress };
  if (lifecycleTransitions.at(-1)?.stage !== lifecycleProject.stage) {
    lifecycleTransitions.push({ turn, stage: lifecycleProject.stage });
  }
}

const identity = buildManufacturedSectorOutput({
  outputAnchor: 10_000,
  supplyRates,
  allocationShare: 0,
  stage: "mature",
  outputCommodity: "vehicles",
  basePrices,
  paidDevelopmentAnchor: projectCost,
  paidThresholdAnchor: projectCost,
});
const legacyUnits = {
  steel: 50,
  building_materials: 100,
};
if (JSON.stringify(identity.outputUnitsByCommodity) !== JSON.stringify(legacyUnits)) {
  throw new Error("Zero allocation changed the legacy offer");
}
const productionHaircut = 0.6;
const scaledIdentity = scaleManufacturedSectorOutput(identity, productionHaircut);
const scaledNominalValue = Object.values(scaledIdentity.outputAnchorByCommodity).reduce(
  (sum, value) => sum + (value ?? 0),
  0
);
if (scaledNominalValue !== 6_000) {
  throw new Error("Physical output haircut did not scale nominal value with quantity");
}

const nppWinner = chooseNppManufacturingProduct([
  {
    kindId: "barely-produced-high-scarcity",
    outputCommodity: "vehicles",
    allocations: [{ sectorId: "plant-a", share: 1 }],
    capacityStock: allocatedCapitalStock,
    capacityWeightedMarginPct: 35,
    scarcityPriceRatio: 1.8,
    supplyMixWeight: 0.1,
  },
  {
    kindId: "recipe-exposed-steel",
    outputCommodity: "steel",
    allocations: [{ sectorId: "plant-a", share: 1 }],
    capacityStock: allocatedCapitalStock,
    capacityWeightedMarginPct: 30,
    scarcityPriceRatio: 1.5,
    supplyMixWeight: 0.8,
  },
])?.kindId;

const lines = [
  "# Manufacturing product lines v2 deterministic balance report",
  "",
  "Generated by `scripts/sim/manufacturingProductLinesV2Balance.ts` from the production lifecycle, allocation, and NPP scoring rules. No game database or world simulation is used.",
  "",
  "## Development funding",
  "",
  `- Allocated physical capital stock: ${money(allocatedCapitalStock)} anchor units.`,
  `- Development threshold: ${money(projectCost)} anchor units (5% of allocated capital). Elapsed threshold: ${MANUFACTURING_DEVELOPMENT_ELAPSED_TURNS} receipts.`,
  `- Funded at 500 anchor units of paid R&D per turn: ${money(funded.paidDevelopment)} goes to development, ${money(funded.genericResearch)} continues to generic research, and launch occurs on receipt ${funded.launchTurn}.`,
  `- Unfunded for ${MANUFACTURING_DEVELOPMENT_ELAPSED_TURNS} turns: ${money(unfunded.paidDevelopment)} development spend and stage remains ${unfunded.project.stage}.`,
  "- Development is a separate capitalized cash investment, limited to available cash and paid once per turn. The matching paid-R&D allocation funds development first; any remainder continues to generic research.",
  "",
  "## One representative operating day by stage",
  "",
  "Assumptions: the established legacy recipe produces 100,000 anchor units of nominal output value per day. Half of plant capacity is allocated to vehicles. Product output redirects recipe value; it does not add output value. The market has demand for 80% of each offered commodity at base prices and neutral posture, so cash receipts use the production clearing rule. These are gross sales receipts before input, wage, upkeep, tax, financing, and development costs, not net income or a sales guarantee.",
  "",
  "<!-- prettier-ignore -->",
  "| Stage | Vehicles value | Other recipe value | Total nominal value | Product-attributed sales cash | Total sales cash | Product quality |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...outputByStage.map(
    (row) =>
      `| ${row.stage} | ${money(row.productValue)} | ${money(row.otherValue)} | ${money(row.nominalValue)} | ${money(row.productSalesCash)} | ${money(row.totalSalesCash)} | ${row.quality == null ? "n/a" : row.quality.toFixed(1)} |`
  ),
  "",
  `- Simulated lifecycle transitions from production rules: ${lifecycleTransitions.map((row) => `${row.stage} at turn ${row.turn}`).join(", ")}.`,
  `- Zero-allocation identity check: ${money(identity.outputAnchorByCommodity.steel ?? 0)} steel and ${money(identity.outputAnchorByCommodity.building_materials ?? 0)} building materials, exactly matching the legacy recipe.`,
  `- The allocated ${Math.round(allocatedShare * 100)}% plant portion receives ${money(allocatedPlantValue)} of that value and retains ${Math.round(allocatedPlantOutput.inputThroughputShare * 100)}% input throughput, so redirected units do not multiply recipe value or input charges.`,
  `- Lifecycle cash timing: the funded path spends ${money(funded.paidDevelopment)} in capitalized development cash over ${MANUFACTURING_DEVELOPMENT_ELAPSED_TURNS} receipts before launch; its first launch day attributes ${money(outputByStage.find((row) => row.stage === "launch")?.productSalesCash ?? 0)} of gross receipts to the redirected vehicle offer at 80% fill. This sales attribution displaces baseline recipe sales rather than adding to them.`,
  `- Applying a ${Math.round(productionHaircut * 100)}% physical production factor scales both commodity quantity and nominal value: 10,000 becomes ${money(scaledNominalValue)} with unchanged unit values.`,
  "",
  "## NPP candidate scoring",
  "",
  "The rule scores capacity-weighted margin multiplied by scarcity premium and the kind's actual legacy strategy mix weight. A high scarcity ratio cannot win solely for a commodity the selected plants barely produce.",
  "",
  `- Selected candidate in the deterministic comparison: ${nppWinner}.`,
  "- Price discovery, sales fill, input costs, wages, taxes, and financing affect realized P&L outside this nominal output conservation report.",
  "",
];

process.stdout.write(lines.join("\n"));
