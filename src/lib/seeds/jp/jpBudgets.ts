import type { CountryId } from "@/lib/constants/countries";

/**
 * Japan regional budget seed inputs.
 *
 * These are passed to `generateStateBudgets()` to produce StateBudget documents
 * for each of Japan's 8 game regions. GDP values are in millions of JPY
 * (matching jpRegions.ts).
 *
 * The national budget is seeded separately via the NATIONAL_BUDGET_SEED_CONFIGS
 * entry in `src/lib/seeds/reference/budgets.ts`.
 */
export interface JPStateBudgetSeedInput {
  id: string;
  population: number;
  gdp: number;
  countryId: CountryId;
}

export const jpRegionalBudgetInputs: JPStateBudgetSeedInput[] = [
  { id: "HOK", population: 5_200_000, gdp: 19_300_000, countryId: "JP" },
  { id: "TOH", population: 8_600_000, gdp: 33_500_000, countryId: "JP" },
  { id: "KAN", population: 43_500_000, gdp: 213_000_000, countryId: "JP" },
  { id: "CHU", population: 21_100_000, gdp: 82_000_000, countryId: "JP" },
  { id: "KNS", population: 22_500_000, gdp: 85_000_000, countryId: "JP" },
  { id: "CGK", population: 7_100_000, gdp: 28_500_000, countryId: "JP" },
  { id: "SHI", population: 3_700_000, gdp: 13_800_000, countryId: "JP" },
  { id: "KYU", population: 14_300_000, gdp: 50_600_000, countryId: "JP" },
];
