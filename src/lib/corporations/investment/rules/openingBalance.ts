/**
 * Opening plant balance compares a starter's price with its nominal revenue.
 * openingPlantScenario uses the same input, payroll and overhead costs as plants.
 */
import type { CorporationType } from "@/lib/constants/corporations";
import { sectorEntryFeeAnchor, foundingStarterUnits } from "@/lib/corporations/foundingPlant";
import {
  computeBuildCost,
  revenuePerCapacityUnitForStrategy,
} from "@/lib/constants/capacityEconomy";
import { getStrategy } from "@/lib/constants/sectorStrategies";
import { COMMODITY_BASE_PRICES, COMMODITY_TYPES } from "@/lib/constants/commodities";
import { getSectorLaborShare, computeSectorLaborCost } from "@/lib/labour/laborCost";
import { computeInputsCost, assemblePhysicalPnl } from "@/lib/corporations/physicalPnl";
import { computePlantOverhead } from "@/lib/corporations/plantCosts/rules";
import { priceRealizationFactor } from "@/lib/market/priceRealization";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";

export function openingPlantScenario(type: CorporationType, primeRate: number, stress = false) {
  const strategy = getStrategy(type, "standard", "1991-default");
  const units = foundingStarterUnits(type);
  const dailyRevenue = units * revenuePerCapacityUnitForStrategy(type, strategy.id, 1);
  const build = computeBuildCost({
    sectorType: type,
    strategyId: strategy.id,
    units,
    year: 1991,
    eraUnitScale: 1,
    primeRate,
    acumen: NEUTRAL_STAT,
    founding: true,
  });
  const price = build.totalAnchor + sectorEntryFeeAnchor("1991-default");
  const hourlyRevenue = (dailyRevenue / TURNS_PER_DAY) * priceRealizationFactor(stress ? 0.9 : 1);
  const inputs = computeInputsCost({
    nominalDailyRevenue: dailyRevenue,
    rates: strategy.demand,
    basePrices: COMMODITY_BASE_PRICES,
    priceRatios: new Map(COMMODITY_TYPES.map((commodity) => [commodity, stress ? 1.1 : 1])),
    utilization: 1,
    inputMultiplier: 1,
    turnsPerDay: TURNS_PER_DAY,
    mothballed: false,
  });
  const labor = computeSectorLaborCost({
    hourlyRevenue,
    grossMaintenance: hourlyRevenue * 0.8,
    laborShare0: getSectorLaborShare(type, 1991),
    wageMultiplier: stress ? 1.1 : 1,
  });
  const overhead = computePlantOverhead({
    nominalDailyRevenue: dailyRevenue,
    capacity: units,
    producedUnits: units,
    turnsPerDay: TURNS_PER_DAY,
    mothballed: false,
  });
  const pnl = assemblePhysicalPnl({
    hourlyRevenue,
    inputsCost: inputs.total,
    laborCost: labor.laborCost,
    otherOpex: overhead,
    upkeep: 0,
    complianceCost: 0,
    financialLegs: 0,
    growthCost: 0,
    policyCredit: 0,
  });
  return {
    type,
    strategy: strategy.id,
    dailyRevenue,
    price,
    priceRevenueRatio: price / dailyRevenue,
    dailyProfit: pnl.profit * TURNS_PER_DAY,
    marginPercent: (100 * pnl.profit) / hourlyRevenue,
    inputsDaily: inputs.total * TURNS_PER_DAY,
    payrollDaily: labor.laborCost * TURNS_PER_DAY,
    overheadDaily: overhead * TURNS_PER_DAY,
  };
}
