/**
 * Gameplay opening CPI and wage growth for authored high-inflation openings.
 *
 * Seed authors record HISTORICAL annual CPI (1991 BR 480%, BG 338.45%, ...) as
 * provenance. The runtime inflation engine only supports MIN_INFLATION..
 * MAX_INFLATION (-2..100); an opening above that range was snapped to 100 on
 * the first recalculation, an unmodelled stabilization (#3317). Openings are
 * therefore calibrated here into gameplay values, before any budget is built.
 *
 * CPI: identity up to OPENING_INFLATION_KNEE, logarithmic above it:
 *
 *   gameplay = h                      for h <= K
 *   gameplay = K * (1 + ln(h / K))    for h >  K
 *
 * The map is monotone (a worse historical inflation stays worse in play) and
 * has slope 1 at the knee, so nothing jumps at the boundary. Inflation above
 * the knee behaves multiplicatively, so a log scale keeps the relative distance
 * between openings. K = 20 is the largest whole-number knee that keeps the whole
 * supported historical domain (up to MAX_SUPPORTED_HISTORICAL_INFLATION, 1000%)
 * strictly inside the runtime ceiling: 1000% maps to 98.2%, 480% to 83.6%.
 * Ordinary openings (at or below 20%) are unchanged.
 *
 * Wages: a calibrated opening cannot keep its authored nominal wage growth (BG
 * authored 330% against what is now ~77% CPI). Its wage growth is rebuilt with
 * the runtime wage rule (`wageGrowthNode`): the real component, clamped to
 * REAL_WAGE_CLAMP, plus WAGE_INFLATION_PASSTHROUGH times CPI. The authored real
 * GDP growth is the real component, as in the transition authoring rule
 * `wageGrowth = inflation + real growth`. The engine recomputes wage growth from
 * the same rule every turn, so the opening now starts where the runtime goes.
 *
 * Pure: plain data in, plain data out. Constants are passed in by the shell.
 */

/** Below or at this annual CPI (%) an opening is used as authored. */
export const OPENING_INFLATION_KNEE = 20;

/** Highest authored historical CPI (%) the calibration accepts. */
export const MAX_SUPPORTED_HISTORICAL_INFLATION = 1000;

export interface OpeningInflationBounds {
  /** Runtime CPI floor (%). */
  minInflation: number;
  /** Runtime CPI ceiling (%). */
  maxInflation: number;
  /** Runtime real wage growth clamp [low, high] (%). */
  realWageClamp: readonly [number, number];
  /** Runtime share of CPI passed into nominal wage growth. */
  wageInflationPassthrough: number;
}

export interface OpeningEconomicFactors {
  gdpGrowth: number;
  wageGrowth: number;
  inflationRate: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Map a historical annual CPI (%) to its gameplay opening CPI (%). */
export function gameplayOpeningInflation(historical: number): number {
  if (historical <= OPENING_INFLATION_KNEE) return historical;
  return round2(OPENING_INFLATION_KNEE * (1 + Math.log(historical / OPENING_INFLATION_KNEE)));
}

/** Why an authored opening is outside the supported calibration domain, or null. */
export function unsupportedOpeningInflation(
  factors: OpeningEconomicFactors,
  bounds: OpeningInflationBounds
): string | null {
  const { inflationRate, wageGrowth, gdpGrowth } = factors;
  if (![inflationRate, wageGrowth, gdpGrowth].every(Number.isFinite)) {
    return "non-finite opening economic factor";
  }
  if (inflationRate < bounds.minInflation) {
    return `CPI ${inflationRate}% is below the runtime floor ${bounds.minInflation}%`;
  }
  if (inflationRate > MAX_SUPPORTED_HISTORICAL_INFLATION) {
    return `CPI ${inflationRate}% exceeds the supported historical maximum ${MAX_SUPPORTED_HISTORICAL_INFLATION}%`;
  }
  return null;
}

/**
 * Calibrate one opening. Returns the factors unchanged at or below the knee;
 * otherwise the gameplay CPI and the runtime-rule wage growth.
 */
export function calibrateOpeningEconomicFactors<T extends OpeningEconomicFactors>(
  factors: T,
  bounds: OpeningInflationBounds
): T {
  const problem = unsupportedOpeningInflation(factors, bounds);
  if (problem) throw new Error(`Unsupported opening inflation: ${problem}`);
  if (factors.inflationRate <= OPENING_INFLATION_KNEE) return factors;

  const inflationRate = gameplayOpeningInflation(factors.inflationRate);
  if (inflationRate > bounds.maxInflation) {
    throw new Error(`Calibrated opening CPI ${inflationRate}% exceeds ${bounds.maxInflation}%`);
  }
  const [realLow, realHigh] = bounds.realWageClamp;
  const real = Math.max(realLow, Math.min(realHigh, factors.gdpGrowth));
  const wageGrowth = round2(real + bounds.wageInflationPassthrough * inflationRate);
  return { ...factors, inflationRate, wageGrowth };
}
