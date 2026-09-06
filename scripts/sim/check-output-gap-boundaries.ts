import {
  advanceOutputGap,
  GDP_GROWTH_BOUND,
  OUTPUT_GAP_BOUND,
} from "../../src/lib/metricEngine/outputGap";

const turnsPerYear = 48;
const gaps = [-15, -10, 0, 10, 15];
const sectors = [-1_000_000, -15, 0, 15, 1_000_000];
const potentials = [-15, 0, 2, 15];

const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

let cases = 0;
let cappedHigh = 0;
let cappedLow = 0;
let maxIdentityError = 0;
for (const prevGap of gaps) {
  for (const sector of sectors) {
    for (const potential of potentials) {
      const step = advanceOutputGap(prevGap, sector, potential, turnsPerYear);
      const identityError = Math.abs(
        step.gdpGrowth -
          (Math.max(-15, Math.min(15, potential)) + (step.gap - prevGap) * turnsPerYear)
      );
      maxIdentityError = Math.max(maxIdentityError, identityError);
      if (!Number.isFinite(step.gap) || !Number.isFinite(step.gdpGrowth))
        throw new Error("non-finite step");
      if (step.gap < OUTPUT_GAP_BOUND[0] || step.gap > OUTPUT_GAP_BOUND[1])
        throw new Error("gap bound");
      if (
        step.gdpGrowth < GDP_GROWTH_BOUND[0] - 1e-9 ||
        step.gdpGrowth > GDP_GROWTH_BOUND[1] + 1e-9
      )
        throw new Error("rate bound");
      if (identityError > 1e-9) throw new Error(`identity error ${identityError}`);
      if (step.gdpGrowth === GDP_GROWTH_BOUND[1]) cappedHigh++;
      if (step.gdpGrowth === GDP_GROWTH_BOUND[0]) cappedLow++;
      cases++;
    }
  }
}

let neutralTurns = 0;
let neutralGap = 10;
let neutralRate = 2;
while (neutralTurns < turnsPerYear) {
  const step = advanceOutputGap(neutralGap, 2, 2, turnsPerYear);
  if (Math.abs(step.gdpGrowth - (2 + (step.gap - neutralGap) * turnsPerYear)) > 1e-9) {
    throw new Error("neutral identity error");
  }
  neutralGap = step.gap;
  neutralRate = step.gdpGrowth;
  neutralTurns++;
}

const invalid = advanceOutputGap(Number.NaN, Number.POSITIVE_INFINITY, Number.NaN, 0);
const roundedBoundary = roundTo(advanceOutputGap(-10, 10, 2, turnsPerYear).gdpGrowth, 3);
const report = {
  cases,
  cappedHigh,
  cappedLow,
  maxIdentityError,
  neutralRecovery: { turns: neutralTurns, gap: neutralGap, gdpGrowth: neutralRate },
  invalidInputRebase: invalid,
  registryRoundedBoundary: roundedBoundary,
  registryRoundingTolerance: Math.abs(roundedBoundary - 15),
};
console.log(JSON.stringify(report, null, 2));
