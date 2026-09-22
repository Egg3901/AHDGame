import type { CountryId } from "@/lib/constants/countries";

export interface CNRegionalBudgetSeedInput {
  id: string;
  population: number;
  /** Regional GDP in millions of CNY. */
  gdp: number;
  countryId: CountryId;
}

/**
 * China geographic-region budget seed inputs.
 *
 * GDP values in CNY millions (2023 NBS estimates).
 * Seven traditional geographic macro-regions group the 31 provincial-level
 * administrative divisions for the initial econ-only launch.
 */
export const cnRegionalBudgetInputs: CNRegionalBudgetSeedInput[] = [
  { id: "DB", population: 99_500_000, gdp: 5_500_000, countryId: "CN" },
  { id: "HB", population: 135_000_000, gdp: 18_000_000, countryId: "CN" },
  { id: "HD", population: 385_000_000, gdp: 42_000_000, countryId: "CN" },
  { id: "HZ", population: 165_000_000, gdp: 16_000_000, countryId: "CN" },
  { id: "HN", population: 132_000_000, gdp: 18_000_000, countryId: "CN" },
  { id: "XN", population: 195_000_000, gdp: 14_000_000, countryId: "CN" },
  { id: "XB", population: 130_000_000, gdp: 8_500_000, countryId: "CN" },
];
