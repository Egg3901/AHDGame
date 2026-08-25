/**
 * GDP denominators for the fiscal surfaces.
 *
 * Two different numbers, deliberately:
 *
 *   liveNationalGdpUnits  the LEVEL to display. `state.gdp` is the A1 SSOT
 *                         (db/types/budget.ts) and moves every turn;
 *                         `federalBudget.gdp` only catches up at fiscal close,
 *                         so it runs up to 6.5% behind (JP, turn 364).
 *
 *   resolveRatioGdp       the BASIS for debt-to-GDP and deficit-to-GDP.
 *                         `gdpSmoothed` per treasuryBalance.ts, so a one-period
 *                         swing cannot move a solvency ratio. The stored
 *                         `debtToGdpRatio` already uses it; the Economy page's
 *                         deficit ratio did not, which put two ratios in one
 *                         strip on different denominators (BR showed 156.2%
 *                         beside a GDP implying 142.9%).
 *
 * Both are in base currency UNITS, not millions.
 */
export function resolveRatioGdp(budget: { gdp?: number; gdpSmoothed?: number }): number {
  const smoothed = budget.gdpSmoothed;
  if (typeof smoothed === "number" && Number.isFinite(smoothed) && smoothed > 0) return smoothed;
  const raw = budget.gdp;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** Sum of regional GDP (stored in millions) expressed in base currency units. */
export function liveNationalGdpUnits(states: { gdp?: number }[]): number {
  return (
    states.reduce(
      (sum, s) => sum + (typeof s.gdp === "number" && Number.isFinite(s.gdp) ? s.gdp : 0),
      0
    ) * 1_000_000
  );
}
