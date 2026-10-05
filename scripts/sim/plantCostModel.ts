/** Deterministic cost scenarios using the same recipe and P&L rules as the turn. */
import { SECTOR_STRATEGIES } from "../../src/lib/constants/sectorStrategies";
import { getSectorLaborShare } from "../../src/lib/labour/laborCost";
import { computeInputsCost, assemblePhysicalPnl } from "../../src/lib/corporations/physicalPnl";
import { computePlantOverhead } from "../../src/lib/corporations/plantCosts/rules";
import { COMMODITY_BASE_PRICES, type CommodityType } from "../../src/lib/constants/commodities";
import { TURNS_PER_DAY, type OperatingSectorType } from "../../src/lib/constants/corporations";

const family: OperatingSectorType[] = [
  "manufacturing",
  "manufacturing_vehicles",
  "chemical_industries",
  "defense",
];
const scenarios = [
  { name: "base", inputRatio: 1, efficiency: 1, saleFraction: 1, priceFactor: 1 },
  { name: "input-inflation", inputRatio: 2.25, efficiency: 1, saleFraction: 1, priceFactor: 1 },
  { name: "process-efficiency", inputRatio: 1, efficiency: 0.88, saleFraction: 1, priceFactor: 1 },
  { name: "recession", inputRatio: 1, efficiency: 1, saleFraction: 0.7, priceFactor: 0.9 },
];

for (const sectorType of family) {
  for (const strategy of SECTOR_STRATEGIES[sectorType]) {
    if (strategy.requiresTechUnlock || Number.parseInt(strategy.minDecade ?? "0") > 1991) continue;
    for (const scenario of scenarios) {
      // Full production and a normalized 24,000/day nominal basket. In a
      // recession, staff and inputs remain due even when some output is unsold.
      const nominalDailyRevenue = 24_000;
      const capacity = 1000;
      const hourlyBasis = nominalDailyRevenue / TURNS_PER_DAY;
      const rates = Object.fromEntries(
        Object.entries(strategy.demand ?? {}).map(([commodity, rate]) => [
          commodity,
          rate * scenario.efficiency,
        ])
      );
      const inputs = computeInputsCost({
        nominalDailyRevenue,
        rates,
        basePrices: COMMODITY_BASE_PRICES,
        priceRatios: new Map(
          (Object.keys(rates) as CommodityType[]).map((commodity) => [
            commodity,
            scenario.inputRatio,
          ])
        ),
        utilization: 1,
        inputMultiplier: 1,
        turnsPerDay: TURNS_PER_DAY,
      });
      const overhead = computePlantOverhead({
        nominalDailyRevenue,
        capacity,
        producedUnits: capacity,
        turnsPerDay: TURNS_PER_DAY,
        mothballed: false,
      });
      const pnl = assemblePhysicalPnl({
        hourlyRevenue: hourlyBasis * scenario.saleFraction * scenario.priceFactor,
        inputsCost: inputs.total,
        laborCost: hourlyBasis * getSectorLaborShare(sectorType, 1991),
        upkeep: 0,
        complianceCost: 0,
        otherOpex: overhead,
        financialLegs: 0,
        growthCost: 0,
        policyCredit: 0,
      });
      console.log(
        JSON.stringify({
          sectorType,
          strategy: strategy.id,
          scenario: scenario.name,
          inputs: pnl.inputsCost,
          labour: pnl.laborCost,
          overhead: pnl.otherOpex,
          revenue: pnl.profit + pnl.totalCost,
          totalCost: pnl.totalCost,
          profit: pnl.profit,
          margin: Math.round(pnl.netMarginPct * 100) / 100,
        })
      );
    }
  }
}
