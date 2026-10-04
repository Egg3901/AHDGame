import {
  tickManufacturingProject,
  buildManufacturedSectorOutput,
} from "../../src/lib/products/rules/manufacturingRules";
import { qualityPremiumMultiplier } from "../../src/lib/market/clearing";
import type { ManufacturingProductProject } from "../../src/lib/products/manufacturingProject";

function model(paidAdvertisingPerTurn: number) {
  let project: ManufacturingProductProject = {
    _id: "product",
    corporationId: "corp",
    activeCorporationId: "corp",
    kindId: "passenger_car",
    stage: "development",
    stageStartedTurn: 1,
    startedTurn: 1,
    allocations: [{ sectorId: "plant", share: 0.5 }],
    developmentPaidAnchor: 1200,
    paidThresholdAnchor: 1200,
    elapsedDevelopmentTurns: 0,
    elapsedThresholdTurns: 12,
  };
  for (let turn = 1; turn <= 12; turn++) {
    const next = tickManufacturingProject({
      project,
      completedTurn: turn,
      advertisingReceipt: { projectId: project._id, turn, amountAnchor: paidAdvertisingPerTurn },
    });
    if (!next) throw new Error("Expected completed development clock");
    project = { ...project, ...next };
  }
  const rows = [];
  for (const turn of [12, 35, 82, 201, 260]) {
    if (turn > 12) {
      const next = tickManufacturingProject({ project, completedTurn: turn });
      if (!next) throw new Error("Expected postlaunch lifecycle clock");
      project = { ...project, ...next };
    }
    const output = buildManufacturedSectorOutput({
      outputAnchor: 10000,
      supplyRates: { vehicles: 1 },
      allocationShare: 0.5,
      stage: project.stage,
      outputCommodity: "vehicles",
      basePrices: { vehicles: 100 },
      currentSectorQualityByCommodity: { vehicles: 60 },
      paidDevelopmentAnchor: project.developmentPaidAnchor,
      paidThresholdAnchor: project.paidThresholdAnchor,
      elapsedThresholdTurns: 12,
      productBrand: project.productBrand,
    });
    const quality = output.productQualityByCommodity.vehicles ?? 60;
    rows.push({
      turn,
      stage: project.stage,
      brand: project.productBrand ?? 0,
      units: output.outputUnitsByCommodity.vehicles ?? 0,
      productUnits: output.projectOutputUnitsByCommodity.vehicles ?? 0,
      quality,
      priceDefense: qualityPremiumMultiplier(quality),
    });
  }
  return rows;
}
const control = model(0);
const paid = model(100);
if (control.some((row, index) => row.units !== paid[index].units))
  throw new Error("Brand changed physical production");
process.stdout.write(
  [
    "# Manufacturing product brand report",
    "",
    "Generated with production portable lifecycle, brand, output and quality-premium rules. This is a deterministic rule comparison, not a world simulation or a production balance claim.",
    "",
    "Both projects start with the same paid 1,200-anchor development cost, require 12 development turns, and allocate half of a 100-unit plant output. Live four-pillar quality is 60. The candidate receives 100 anchor of already-paid delivered advertising on each development turn; the control receives none. Each advertising receipt is a cash-settlement input, never a planned budget.",
    "",
    "Brand is average funded advertising per development turn. The price-defense contribution is bounded at 10 quality points for the product portion, scales with lifecycle stage, and uses the project's development cost per required turn as its monetary reference. Unallocated baseline output receives neither the product's development nor brand bonus. The existing quality-premium flag gates price effects.",
    "",
    "<!-- prettier-ignore -->",
    "| Turn | Stage | Total units, both | Product units, both | Control quality | Paid brand | Candidate quality | Control premium multiplier | Candidate premium multiplier |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...control.map((row, index) => {
      const next = paid[index];
      return `| ${row.turn} | ${row.stage} | ${row.units} | ${row.productUnits} | ${row.quality} | ${next.brand} | ${next.quality} | ${row.priceDefense.toFixed(4)} | ${next.priceDefense.toFixed(4)} |`;
    }),
    "",
    "Native-cash integration tests separately prove a USD buyer debit matches an EUR seller credit at the frozen rate, retry neither pays twice nor accumulates brand twice, changed source denominations refuse before any seller credit, and project CAS races retain their paid receipts.",
    "",
  ].join("\n")
);
