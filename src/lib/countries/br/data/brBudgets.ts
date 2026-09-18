import type { CountryId } from "@/lib/constants/countries";

export interface BRRegionalBudgetSeedInput {
  id: string;
  population: number;
  /** Regional GDP in millions of BRL. */
  gdp: number;
  countryId: CountryId;
}

/**
 * Brazil macro-region budget seed inputs.
 *
 * GDP values in BRL millions (2023 IBGE estimates).
 * Five IBGE macro-regions are used as playable regions for the initial
 * econ-only launch; state-level granularity can be added when political
 * features are enabled.
 */
export const brRegionalBudgetInputs: BRRegionalBudgetSeedInput[] = [
  { id: "NORTE", population: 18_430_000, gdp: 480_000, countryId: "BR" },
  { id: "NORDESTE", population: 57_071_000, gdp: 1_400_000, countryId: "BR" },
  { id: "CENTRO_OESTE", population: 16_729_000, gdp: 1_200_000, countryId: "BR" },
  { id: "SUDESTE", population: 88_371_000, gdp: 6_200_000, countryId: "BR" },
  { id: "SUL", population: 30_367_000, gdp: 1_800_000, countryId: "BR" },
];
