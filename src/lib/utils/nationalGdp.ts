/**
 * National GDP aggregation for the metrics masthead.
 *
 * `state.gdp` is stored in local-currency **millions** (see CountryConfig's
 * gdp-to-USD multiplier docs). National GDP is the sum of regional GDP; per
 * capita is national GDP expressed in base local-currency units divided by total
 * population.
 */
export interface NationalGdp {
  /** Sum of regional GDP, in local-currency millions. */
  gdpMillions: number;
  /** National GDP per capita, in base local-currency units. */
  perCapita: number;
}

export function aggregateNationalGdp(states: { gdp?: number; population: number }[]): NationalGdp {
  const gdpMillions = states.reduce((sum, s) => sum + (s.gdp ?? 0), 0);
  const population = states.reduce((sum, s) => sum + s.population, 0);
  const perCapita = population > 0 ? (gdpMillions * 1_000_000) / population : 0;
  return { gdpMillions, perCapita };
}
