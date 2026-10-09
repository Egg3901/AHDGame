/**
 * 1991 household income vintage rules (#3370 NG, #3371 TR, #3376 CN; parent #3316).
 *
 * Pure: plain data in, plain data out. No database, clock, randomness or env.
 *
 * `economic.medianIncome` is ANNUAL HOUSEHOLD median income in the region's
 * local currency. GDP per resident is a per-person output measure. The two are
 * different quantities and are NOT expected to be equal; the proxy below only
 * keeps them in the same currency vintage and in a bounded relationship.
 *
 *   household median = GDP per resident
 *                    x mean household size
 *                    x household income share of GDP
 *                    x median / mean household income
 *
 * Every factor is bounded so a typo cannot reintroduce a 2023-naira or
 * 1979-lira scale error. The result is a gameplay proxy, not a measured
 * historical median.
 */

export interface HouseholdIncomeProxy {
  /** Mean persons per household. */
  householdSize: number;
  /** Household (primary + transfer) income as a share of GDP. */
  householdIncomeShare: number;
  /** Median over mean household income; below 1 for any right-skewed distribution. */
  medianToMean: number;
}

export const HOUSEHOLD_INCOME_PROXY_BOUNDS: Record<keyof HouseholdIncomeProxy, [number, number]> = {
  householdSize: [2, 7],
  householdIncomeShare: [0.4, 0.8],
  medianToMean: [0.55, 0.95],
};

export function assertProxyInBounds(proxy: HouseholdIncomeProxy): void {
  for (const key of Object.keys(HOUSEHOLD_INCOME_PROXY_BOUNDS) as Array<
    keyof HouseholdIncomeProxy
  >) {
    const [min, max] = HOUSEHOLD_INCOME_PROXY_BOUNDS[key];
    const v = proxy[key];
    if (!Number.isFinite(v) || v < min || v > max) {
      throw new Error(`income1991: ${key}=${v} outside [${min}, ${max}]`);
    }
  }
}

export function nationalHouseholdMedianFromGdp(
  gdpPerResident: number,
  proxy: HouseholdIncomeProxy
): number {
  assertProxyInBounds(proxy);
  if (!Number.isFinite(gdpPerResident) || gdpPerResident <= 0) {
    throw new Error(`income1991: gdpPerResident=${gdpPerResident} must be positive`);
  }
  return gdpPerResident * proxy.householdSize * proxy.householdIncomeShare * proxy.medianToMean;
}

export interface RegionalIncomeInput {
  id: string;
  population: number;
  /** Any-vintage regional income; only its RELATIVE shape is kept. */
  baseIncome: number;
}

/**
 * Rescale regional incomes so their population-weighted mean equals the
 * national target. A single multiplicative factor, so every region keeps its
 * ratio to every other region.
 */
export function scaleRegionalIncomes(
  regions: RegionalIncomeInput[],
  nationalTarget: number
): Record<string, number> {
  let pop = 0;
  let weighted = 0;
  for (const r of regions) {
    if (!(r.population > 0) || !(r.baseIncome > 0)) {
      throw new Error(`income1991: region ${r.id} needs positive population and income`);
    }
    pop += r.population;
    weighted += r.population * r.baseIncome;
  }
  if (pop <= 0) throw new Error("income1991: no regions");
  const factor = nationalTarget / (weighted / pop);
  const out: Record<string, number> = {};
  for (const r of regions) out[r.id] = Math.round(r.baseIncome * factor);
  return out;
}
