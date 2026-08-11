/**
 * Display-side economic outlook verdict for the national Economic Outlook
 * page. Pure derivation from indicators that already exist — nothing is
 * stored, and deleting this module leaves no trace in the data.
 *
 * Thresholds anchor on the simulation's own neutrals
 * (`src/lib/budget/inflation.ts`): trend GDP growth 2.0%/yr and the
 * per-country inflation target (`getInflationTarget`, base 2.0%).
 */

export type EconomicVerdict = "EXPANDING" | "STEADY" | "COOLING" | "CONTRACTING" | "OVERHEATING";

export interface EconomicOutlookInputs {
  /** Hero GDP growth (%/yr) — the central-bank national figure. */
  gdpGrowth: number | null;
  /** Current inflation (%/yr). */
  inflation: number | null;
  /** Country inflation target (%/yr). */
  inflationTarget: number;
  /** Unemployment trend (pp change; negative = falling = improving). */
  unemploymentTrend: number | null;
}

export interface EconomicOutlook {
  verdict: EconomicVerdict;
  reasoning: string;
}

/** Trend GDP growth the simulation's Phillips curve pivots on. */
const TREND_GROWTH = 2.0;
/** Growth this far above trend reads as a broad expansion. */
const EXPANSION_MARGIN = 1.0;
/** Growth this far below trend (but ≥ 0) reads as cooling. */
const COOLING_MARGIN = 1.0;
/** Inflation this far above target flips a growing economy to OVERHEATING. */
const OVERHEAT_INFLATION_MARGIN = 3.0;
/** Inflation within this band of target reads as "near target". */
const NEAR_TARGET_BAND = 0.5;

function signed(value: number, digits = 1): string {
  const fixed = value.toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
}

export function deriveEconomicOutlook(inputs: EconomicOutlookInputs): EconomicOutlook | null {
  const { gdpGrowth, inflation, inflationTarget, unemploymentTrend } = inputs;
  if (gdpGrowth == null || inflation == null) return null;

  let verdict: EconomicVerdict;
  if (gdpGrowth < 0) {
    // Contraction outranks everything — stagflation still reads CONTRACTING.
    verdict = "CONTRACTING";
  } else if (inflation >= inflationTarget + OVERHEAT_INFLATION_MARGIN) {
    verdict = "OVERHEATING";
  } else if (gdpGrowth >= TREND_GROWTH + EXPANSION_MARGIN) {
    verdict = "EXPANDING";
  } else if (gdpGrowth < TREND_GROWTH - COOLING_MARGIN) {
    verdict = "COOLING";
  } else {
    verdict = "STEADY";
  }

  const growthClause =
    gdpGrowth < 0
      ? `output shrinking (${signed(gdpGrowth)}%)`
      : gdpGrowth >= TREND_GROWTH + EXPANSION_MARGIN
        ? `broad growth (${signed(gdpGrowth)}%, above the ~${TREND_GROWTH.toFixed(0)}% trend)`
        : gdpGrowth < TREND_GROWTH - COOLING_MARGIN
          ? `growth below trend (${signed(gdpGrowth)}% vs ~${TREND_GROWTH.toFixed(0)}%)`
          : `growth at trend (${signed(gdpGrowth)}% vs ~${TREND_GROWTH.toFixed(0)}%)`;

  const inflationGap = inflation - inflationTarget;
  const priceClause =
    Math.abs(inflationGap) <= NEAR_TARGET_BAND
      ? `prices near target (${inflation.toFixed(1)}% vs ${inflationTarget.toFixed(1)}% target)`
      : inflationGap > 0
        ? `price pressure elevated (${inflation.toFixed(1)}% vs ${inflationTarget.toFixed(1)}% target)`
        : `prices soft (${inflation.toFixed(1)}% vs ${inflationTarget.toFixed(1)}% target)`;

  const laborClause =
    unemploymentTrend == null
      ? null
      : unemploymentTrend < 0
        ? "labor market improving"
        : unemploymentTrend > 0
          ? "unemployment ticking up"
          : "labor market steady";

  const clauses = [growthClause, priceClause, ...(laborClause ? [laborClause] : [])];
  const reasoning = `${clauses.join(" · ")} — derived from current indicators, nothing stored.`;

  return { verdict, reasoning };
}
