import type { CountryId } from "@/lib/constants/countries";

/**
 * Germany regional budget seed inputs.
 *
 * Passed to `generateStateBudgets()` to produce StateBudget documents for
 * each of the 16 Bundesländer. GDP values are in millions of EUR
 * (matches deRegions.ts).
 *
 * The federal (national) budget is seeded separately via the
 * NATIONAL_BUDGET_SEED_CONFIGS entry in `src/lib/seeds/reference/budgets.ts`.
 */
export interface DEStateBudgetSeedInput {
  id: string;
  population: number;
  gdp: number;
  countryId: CountryId;
}

export const deRegionalBudgetInputs: DEStateBudgetSeedInput[] = [
  { id: "BW", population: 11_280_000, gdp: 579_000, countryId: "DE" },
  { id: "BY", population: 13_176_000, gdp: 716_000, countryId: "DE" },
  { id: "NW", population: 18_140_000, gdp: 774_000, countryId: "DE" },
  { id: "HE", population: 6_392_000, gdp: 321_000, countryId: "DE" },
  { id: "RP", population: 4_162_000, gdp: 170_000, countryId: "DE" },
  { id: "SL", population: 993_000, gdp: 37_000, countryId: "DE" },
  { id: "NI", population: 8_141_000, gdp: 345_000, countryId: "DE" },
  { id: "SH", population: 2_933_000, gdp: 108_000, countryId: "DE" },
  { id: "HH", population: 1_930_000, gdp: 142_000, countryId: "DE" },
  { id: "BRE", population: 685_000, gdp: 35_000, countryId: "DE" },
  { id: "BE", population: 3_850_000, gdp: 180_000, countryId: "DE" },
  { id: "BB", population: 2_573_000, gdp: 85_000, countryId: "DE" },
  { id: "MV", population: 1_624_000, gdp: 52_000, countryId: "DE" },
  { id: "SN", population: 4_057_000, gdp: 145_000, countryId: "DE" },
  { id: "ST", population: 2_186_000, gdp: 74_000, countryId: "DE" },
  { id: "TH", population: 2_115_000, gdp: 68_000, countryId: "DE" },
];
