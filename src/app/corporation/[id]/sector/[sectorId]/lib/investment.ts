import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import type { InvestmentForecastInput } from "@/lib/corporations/investment/rules";
import type { PlantsData } from "../types";

/** Project the same observed figures for the displayed scenario and sizing controls. */
export function investmentForecastInput(
  plants: PlantsData,
  units: number
): InvestmentForecastInput | null {
  const pnl = plants.pnl;
  const assumptions = plants.investment;
  return assumptions
    ? {
        units,
        constructionPerUnitAnchor: plants.buildQuote.perUnitAnchor,
        chargedPerUnitAnchor: plants.buildQuote.perUnitChargedAnchor,
        buildTurns: plants.buildTurns,
        depreciationPerTurn: plants.depreciationPerTurn,
        turnsPerDay: TURNS_PER_DAY,
        capacityUnits: plants.capacityUnits ?? 0,
        activeFraction: plants.mothballed ? 0 : (plants.activeCapacityPercent ?? 100) / 100,
        producedUnits: plants.producedUnits ?? 0,
        soldUnits: plants.soldUnits ?? 0,
        demandGapUnits: plants.demandGapUnits ?? 0,
        revenueDailyAnchor: Math.max(
          0,
          pnl.revenueAnchor - (assumptions.inventoryRevenueDailyAnchor ?? 0)
        ),
        operatingCostDailyAnchor:
          pnl.inputsAnchor +
          pnl.labourAnchor +
          pnl.complianceAnchor +
          pnl.otherOperatingAnchor +
          pnl.growthAndBuildAnchor +
          (assumptions.freightNetCostDailyAnchor ?? 0),
        inputsCostDailyAnchor: pnl.inputsAnchor,
        policyCreditDailyAnchor: pnl.policyAnchor ?? 0,
        overheadDailyAnchor: assumptions.overheadDailyAnchor,
        upkeepDailyAnchor: pnl.upkeepAnchor,
        taxRatePercent: assumptions.taxRatePercent,
      }
    : null;
}
