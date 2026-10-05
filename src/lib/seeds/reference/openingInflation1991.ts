import type { NationalBudgetSeedConfig } from "./budgets";
import {
  calibrateOpeningEconomicFactors,
  type OpeningInflationBounds,
} from "./rules/openingInflation";

/**
 * The runtime contract the 1991 opening is calibrated against (#3317):
 * MIN_INFLATION/MAX_INFLATION (budget/inflation.ts) and REAL_WAGE_CLAMP/
 * WAGE_INFLATION_PASSTHROUGH (metricEngine/registry/economic.ts). Copied, not
 * imported, so the seed graph stays free of the turn engine; a test pins them.
 */
export const OPENING_INFLATION_BOUNDS: OpeningInflationBounds = {
  minInflation: -2,
  maxInflation: 100,
  realWageClamp: [-5, 15],
  wageInflationPassthrough: 0.1,
};

/**
 * Replace an authored historical CPI and its wage growth with gameplay opening
 * values. The authored config keeps the historical figure as provenance; only
 * the seeded budget sees the calibrated one. See rules/openingInflation.ts.
 */
export function calibrateOpeningInflation1991(
  config: NationalBudgetSeedConfig
): NationalBudgetSeedConfig {
  const economicFactors = calibrateOpeningEconomicFactors(
    config.economicFactors,
    OPENING_INFLATION_BOUNDS
  );
  return economicFactors === config.economicFactors ? config : { ...config, economicFactors };
}
