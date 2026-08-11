/**
 * Political-legislation cost engine (design spec §4). One pure function used by
 * seeding previews, the API, the proposal/voting UI, budget integration, tests.
 *
 *   cost    = gdpCostFraction    × GDP(scope)
 *           + incomeCostFraction × COST_INCOME_ANCHORS[country] × bandIndex × population(scope)
 *   revenue = gdpRevenueFraction × GDP(scope)
 *   net     = revenue − cost                       (local currency, annual)
 *
 * A null/absent incomeBandIndex is treated as 1.0 everywhere (fixed rule: the
 * index is unset before the first flag-on turn, but baseline seeding and
 * pre-first-turn estimates run at reset time).
 */

import { COST_INCOME_ANCHORS } from "./costAnchors";
import type { LawCountryId, LawLevel } from "./types";

export interface FiscalBase {
  /** Absolute local currency (NOT the states collection's millions unit). */
  gdp: number;
  population: number;
}

export interface LawFiscal {
  cost: number;
  revenue: number;
  /** revenue − cost */
  net: number;
}

export function computeLawCost(
  level: LawLevel,
  base: FiscalBase,
  countryId: LawCountryId,
  incomeBandIndex: number | null | undefined
): LawFiscal {
  const bandIndex = incomeBandIndex ?? 1.0;
  const cost =
    (level.gdpCostFraction ?? 0) * base.gdp +
    (level.incomeCostFraction ?? 0) * COST_INCOME_ANCHORS[countryId] * bandIndex * base.population;
  const revenue = (level.gdpRevenueFraction ?? 0) * base.gdp;
  return { cost, revenue, net: revenue - cost };
}
