/**
 * Reproducible partial-equilibrium investment calibration. Runs the shared
 * pricing and forecast rules with fixed demand, not the full world engine.
 * Usage: npx tsx scripts/sim/sectorInvestmentCalibration.ts
 */
import { computeBuildCost, revenuePerCapacityUnit } from "@/lib/constants/capacityEconomy";
import {
  forecastSectorInvestment,
  investmentBuildTurns,
} from "@/lib/corporations/investment/rules";
import { CAPITAL_DEPRECIATION_PER_TURN } from "@/lib/market/capital";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";

const profiles = {
  baseline: { expansionCostMultiplier: 1, heavyBuildTimeMultiplier: 1 },
  price: { expansionCostMultiplier: 0.8, heavyBuildTimeMultiplier: 1 },
  delivery: { expansionCostMultiplier: 1, heavyBuildTimeMultiplier: 0.5 },
  combined: { expansionCostMultiplier: 0.8, heavyBuildTimeMultiplier: 0.5 },
};
const sectorType = "energy";
const baseBuildTurns = 96;
const budgetAnchor = 100000;
const quote = computeBuildCost({
  sectorType,
  strategyId: null,
  units: 1,
  year: 1966,
  eraUnitScale: 1,
  primeRate: 5,
});
const undiscountedUnit = quote.totalAnchor / quote.expansionMultiplier;
const receiptPerUnit = revenuePerCapacityUnit(sectorType, 1);
const results = Object.entries(profiles).map(([profile, policy]) => {
  const perUnit = undiscountedUnit * policy.expansionCostMultiplier;
  const units = Math.floor(budgetAnchor / perUnit);
  const horizons = forecastSectorInvestment({
    units,
    constructionPerUnitAnchor: perUnit,
    chargedPerUnitAnchor: perUnit,
    buildTurns: investmentBuildTurns(baseBuildTurns, false, policy),
    depreciationPerTurn: CAPITAL_DEPRECIATION_PER_TURN,
    turnsPerDay: TURNS_PER_DAY,
    capacityUnits: 1000,
    activeFraction: 1,
    producedUnits: 1000,
    soldUnits: 1000,
    demandGapUnits: units * 2,
    revenueDailyAnchor: 1000 * receiptPerUnit,
    operatingCostDailyAnchor: 1000 * receiptPerUnit * 0.65,
    overheadDailyAnchor: 1000 * receiptPerUnit * 0.05,
    upkeepDailyAnchor: 0,
    taxRatePercent: 20,
  });
  return {
    profile,
    units,
    chargedAnchor: perUnit * units,
    buildTurns: investmentBuildTurns(baseBuildTurns, false, policy),
    horizons,
  };
});
console.log(
  JSON.stringify(
    {
      scope:
        "Controlled investment arithmetic, fixed prices and ample demand. No market, fiscal or rival feedback. Not observed arbitrage returns.",
      assumptions: {
        sectorType,
        budgetAnchor,
        primeRatePercent: 5,
        operatingMarginBeforeOverheadPercent: 35,
        overheadSharePercent: 5,
        taxRatePercent: 20,
        baseBuildTurns,
        annualTurns: 48,
        depreciationPerTurn: CAPITAL_DEPRECIATION_PER_TURN,
      },
      results,
    },
    null,
    2
  )
);
