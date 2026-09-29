/** Bounded, global climate exposure derived from population-weighted emissions. */
export interface EmissionsRegion {
  population: number;
  tonsPerCapita: number;
}

export interface ClimateExposure {
  pressure: number;
  globalTonsPerCapita: number;
}

const BASELINE_TONS_PER_CAPITA = 4;
const PRESSURE_PER_EXCESS_TON_YEAR = 0.006;
const PRESSURE_RECOVERY_PER_YEAR = 0.002;

const clamp = (value: number, lower: number, upper: number) =>
  Math.max(lower, Math.min(upper, value));

/** An absent region metric is omitted rather than silently read as zero emissions. */
export function populationWeightedEmissions(regions: readonly EmissionsRegion[]): number | null {
  let people = 0;
  let tonnes = 0;
  for (const region of regions) {
    if (
      !Number.isFinite(region.population) ||
      region.population <= 0 ||
      !Number.isFinite(region.tonsPerCapita) ||
      region.tonsPerCapita < 0
    )
      continue;
    people += region.population;
    tonnes += region.population * region.tonsPerCapita;
  }
  return people > 0 ? tonnes / people : null;
}

/** A year's emissions affect future risk gradually; lower emissions slowly reduce exposure. */
export function advanceClimateExposure(
  priorPressure: number,
  globalTonsPerCapita: number,
  elapsedYears: number
): ClimateExposure {
  if (
    !Number.isFinite(priorPressure) ||
    !Number.isFinite(globalTonsPerCapita) ||
    !Number.isFinite(elapsedYears) ||
    globalTonsPerCapita < 0 ||
    elapsedYears < 0
  )
    throw new Error("Climate exposure inputs must be finite and non-negative");
  const changePerYear =
    globalTonsPerCapita > BASELINE_TONS_PER_CAPITA
      ? (globalTonsPerCapita - BASELINE_TONS_PER_CAPITA) * PRESSURE_PER_EXCESS_TON_YEAR
      : -PRESSURE_RECOVERY_PER_YEAR;
  return {
    pressure: clamp(priorPressure + changePerYear * Math.min(elapsedYears, 5), 0, 1),
    globalTonsPerCapita,
  };
}

/** Geophysical and industrial events do not become more likely from climate pressure. */
export const WEATHER_DISASTER_KEYS = new Set([
  "hurricane",
  "wildfire",
  "drought_famine",
  "extreme_heat",
  "tornado",
  "flood",
  "winter_storm",
  "dust_storm",
  "hailstorm",
  "king_tide_flooding",
  "forest_pest_outbreak",
]);

/** Adaptation reduces regional loss; exposure never multiplies it above 1.5. */
export function climateLossMultiplier(pressure: number, resilience: number): number {
  const exposed = clamp(Number.isFinite(pressure) ? pressure : 0, 0, 1);
  const protectedShare = clamp(Number.isFinite(resilience) ? resilience / 100 : 0.5, 0, 1);
  return 1 + 0.5 * exposed * (1 - protectedShare);
}

/** Weather-only early opening is bounded to a 108-turn minimum from the 144-turn base. */
export function weatherDisasterCadence(baseCadence: number, pressure: number): number {
  const exposed = clamp(Number.isFinite(pressure) ? pressure : 0, 0, 1);
  return Math.max(Math.round(baseCadence * 0.75), Math.round(baseCadence / (1 + 0.3 * exposed)));
}
