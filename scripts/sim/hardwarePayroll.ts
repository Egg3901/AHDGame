/** Deterministic physical-cost scenarios. No database, network, or player data. */
import { strict as assert } from "node:assert";
import { getStrategy } from "../../src/lib/constants/sectorStrategies";
import { COMMODITY_BASE_PRICES, type CommodityType } from "../../src/lib/constants/commodities";
import { TURNS_PER_DAY } from "../../src/lib/constants/turnTime";
import { computeInputsCost, assemblePhysicalPnl } from "../../src/lib/corporations/physicalPnl";
import { computePlantOverhead, plantLaborShare } from "../../src/lib/corporations/plantCosts/rules";
import { computeSectorLaborCost, getSectorLaborShare } from "../../src/lib/labour/laborCost";
import { computePriceRealization } from "../../src/lib/market/priceRealization";

const scenarios = [
  { name: "base", inputRatio: 1, outputRatio: 1, production: 1, sold: 1, policyPp: 0 },
  { name: "scarcity", inputRatio: 2.25, outputRatio: 2.33, production: 1, sold: 1, policyPp: 0 },
  { name: "input-shock", inputRatio: 4, outputRatio: 1, production: 1, sold: 1, policyPp: 0 },
  { name: "starved", inputRatio: 2.25, outputRatio: 2.33, production: 0.6, sold: 1, policyPp: 0 },
  { name: "unsold", inputRatio: 1, outputRatio: 1, production: 1, sold: 0.5, policyPp: 0 },
  { name: "policy-charge", inputRatio: 1, outputRatio: 1, production: 1, sold: 1, policyPp: -20 },
];
let assertions = 0;
const rows = [];
for (const year of [1953, 1991, 2027])
  for (const strategyId of ["hardware", "standard", "software"])
    for (const wage of [1, 1.2, 1.3])
      for (const scale of [1, 100])
        for (const scenario of scenarios) {
          const nominalDailyRevenue = 24_000 * scale;
          const nominal = nominalDailyRevenue / TURNS_PER_DAY;
          const strategy = getStrategy("technology", strategyId, "1991-default");
          const outputRatios = new Map(
            (Object.keys(strategy.supply) as CommodityType[]).map((commodity) => [
              commodity,
              scenario.outputRatio,
            ])
          );
          const revenue =
            nominal *
            scenario.production *
            scenario.sold *
            computePriceRealization(strategy.supply, outputRatios);
          const inputs = computeInputsCost({
            nominalDailyRevenue,
            rates: strategy.demand,
            basePrices: COMMODITY_BASE_PRICES,
            priceRatios: new Map(
              (Object.keys(strategy.demand) as CommodityType[]).map((commodity) => [
                commodity,
                scenario.inputRatio,
              ])
            ),
            utilization: scenario.production,
            inputMultiplier: 1,
            turnsPerDay: TURNS_PER_DAY,
          });
          const overhead = computePlantOverhead({
            nominalDailyRevenue,
            capacity: 1000 * scale,
            producedUnits: 1000 * scale * scenario.production,
            turnsPerDay: TURNS_PER_DAY,
            mothballed: false,
          });
          const pnl = (share: number) => {
            const labor = computeSectorLaborCost({
              hourlyRevenue: nominal,
              grossMaintenance: nominal,
              laborShare0: share,
              wageMultiplier: wage,
            });
            return assemblePhysicalPnl({
              hourlyRevenue: revenue,
              inputsCost: inputs.total,
              laborCost: labor.laborCost,
              upkeep: 0,
              complianceCost: 0,
              otherOpex: overhead,
              financialLegs: 0,
              growthCost: 0,
              policyCredit: (revenue * scenario.policyPp) / 100,
            });
          };
          const before = pnl(getSectorLaborShare("technology", year));
          const after = pnl(
            plantLaborShare({ sectorType: "technology", strategyId, currentTurn: 100, year })
          );
          const expectedPayrollSaving = strategyId === "hardware" ? before.laborCost * 0.25 : 0;
          assert(Math.abs(after.profit - before.profit - expectedPayrollSaving) < 1e-7);
          assert(after.inputsCost === before.inputsCost);
          assert(after.otherOpex === before.otherOpex);
          assertions += 3;
          if (strategyId !== "hardware") {
            assert.deepEqual(after, before);
            assertions++;
          }
          rows.push({
            year,
            strategyId,
            wage,
            scale,
            scenario: scenario.name,
            revenue,
            beforeProfit: before.profit,
            afterProfit: after.profit,
            beforeMargin: before.netMarginPct,
            afterMargin: after.netMarginPct,
            payrollSaving: before.laborCost - after.laborCost,
          });
        }
console.log(
  JSON.stringify(
    {
      qualification:
        "Deterministic physical-cost sensitivity only; not a world trajectory or deployment result.",
      assertions,
      rows,
    },
    null,
    2
  )
);
