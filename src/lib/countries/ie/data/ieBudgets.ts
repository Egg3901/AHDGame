import type { CountryId } from "@/lib/constants/countries";

export interface IERegionalBudgetSeedInput {
  id: string;
  population: number;
  /** Regional GDP in millions of EUR. */
  gdp: number;
  countryId: CountryId;
}

/**
 * Ireland NUTS III planning-region budget seed inputs.
 *
 * GDP values in EUR millions (2023 CSO / Eurostat estimates).
 * National GDP is inflated by MNC profit-shifting; these regional figures
 * use Modified Gross National Income (GNI*) proxies for better gameplay feel.
 */
export const ieRegionalBudgetInputs: IERegionalBudgetSeedInput[] = [
  { id: "DUB", population: 1_458_000, gdp: 180_000, countryId: "IE" },
  { id: "KIL", population: 610_000, gdp: 42_000, countryId: "IE" },
  { id: "MID", population: 315_000, gdp: 18_000, countryId: "IE" },
  { id: "LIM", population: 432_000, gdp: 38_000, countryId: "IE" },
  { id: "COR", population: 598_000, gdp: 65_000, countryId: "IE" },
  { id: "WEX", population: 389_000, gdp: 28_000, countryId: "IE" },
  { id: "GAL", population: 453_000, gdp: 35_000, countryId: "IE" },
  { id: "DON", population: 485_000, gdp: 25_000, countryId: "IE" },
];
