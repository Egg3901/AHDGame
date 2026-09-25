import type { NationalBudgetSeedConfig } from "./budgets";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "./successorGdp1991";
import { SUCCESSOR_REGION_POPULATION_1991 } from "./successorPopulation1991";
import { SUCCESSOR_1991_GENERAL_GOVERNMENT_GDP_PERCENT } from "./successorFiscal1991";
import { PL_1991_BUDGET_LAW_MILLION_PLZ } from "@/lib/countries/pl/data/plFiscal1991";
import { easternBlocPolicyConfig } from "@/lib/seeds/shared/easternBlocLegislation";
import { allocateTransitionFiscal1991 } from "./rules/allocateTransitionFiscal1991";

/**
 * January 1991 transition fiscal openings. GDP and population use this era's
 * authored national/regional series. Five general-government totals come from
 * IMF WP/94/104 Table 1; Russia and Yugoslavia are separately documented in
 * successorFiscal1991. Poland instead uses its enacted national Budget Act,
 * so its national budget is smaller than the IMF general-government total.
 *
 * The tax-base split and functional spending split are scenario allocations:
 * comparable 1991 detail is unavailable across these seven budget systems.
 * Their sum is constrained to each published/estimated fiscal total. The
 * residual "other" receipt includes SOE income and non-tax revenue. Debt is a
 * conservative opening scenario reserve, not an assertion of historic gross
 * public debt. Economic growth/CPI for five countries use 1991 WDI series;
 * CS and RU CPI, and YU growth/CPI are explicit transition estimates.
 * WDI: https://api.worldbank.org/v2/country/POL/indicator/NY.GDP.MKTP.KD.ZG?date=1991&format=json
 * WDI: https://api.worldbank.org/v2/country/POL/indicator/FP.CPI.TOTL.ZG?date=1991&format=json
 */
const opening = {
  RU: { currencyCode: "SUR", growth: -5.05, inflation: 144, debtShare: 0.2, rating: "B" },
  PL: { currencyCode: "PLZ", growth: -7.02, inflation: 76.77, debtShare: 0.7, rating: "B" },
  CS: { currencyCode: "CSK", growth: -12.5, inflation: 55, debtShare: 0.2, rating: "BB" },
  HU: { currencyCode: "HUF", growth: -11.89, inflation: 34.82, debtShare: 0.7, rating: "BB" },
  RO: { currencyCode: "ROL", growth: -12.92, inflation: 230.62, debtShare: 0.2, rating: "B" },
  BG: { currencyCode: "BGL", growth: -8.45, inflation: 338.45, debtShare: 0.7, rating: "B" },
  YU: { currencyCode: "YUD", growth: -7, inflation: 164, debtShare: 0.5, rating: "B" },
} as const;

const taxBaseRatios = {
  taxableIncome: 0.4,
  corporateProfits: 0.2,
  wagesAndSalaries: 0.4,
  importValue: 0.15,
  taxableSales: 0.7,
};

// Effective opening rates, not the old planned-economy default law settings.
const taxRateOverrides = {
  incomeTax: 12,
  domesticCorporateTax: 35,
  foreignCorporateTax: 35,
  payrollTax: 20,
  tariffs: 5,
  salesTax: 16,
};

const coreRevenueGdpShare =
  (taxBaseRatios.taxableIncome * taxRateOverrides.incomeTax) / 100 +
  (taxBaseRatios.corporateProfits * taxRateOverrides.domesticCorporateTax) / 100 +
  (taxBaseRatios.wagesAndSalaries * taxRateOverrides.payrollTax) / 100 +
  (taxBaseRatios.importValue * taxRateOverrides.tariffs) / 100 +
  (taxBaseRatios.taxableSales * taxRateOverrides.salesTax) / 100;

const spendingShares = {
  healthcare: 0.11,
  education: 0.12,
  defense: 0.08,
  socialSecurity: 0.28,
  infrastructure: 0.2,
  other: 0.11,
  stateGrants: 0.1,
} as const;

export const SUCCESSOR_NATIONAL_BUDGETS_1991: NationalBudgetSeedConfig[] = (
  Object.keys(opening) as Array<keyof typeof opening>
).map((countryId) => {
  const profile = opening[countryId];
  const gdp = SUCCESSOR_NOMINAL_GDP_1991[countryId];
  const population = Object.values(SUCCESSOR_REGION_POPULATION_1991[countryId]).reduce(
    (sum, count) => sum + count,
    0
  );
  const fiscal = SUCCESSOR_1991_GENERAL_GOVERNMENT_GDP_PERCENT[countryId];
  const plLaw = countryId === "PL" ? PL_1991_BUDGET_LAW_MILLION_PLZ : null;
  const revenueTotal = plLaw ? plLaw.revenue * 1_000_000 : Math.round((gdp * fiscal.revenue) / 100);
  const expenditureTotal = plLaw
    ? plLaw.expenditure * 1_000_000
    : Math.round((gdp * fiscal.expenditure) / 100);
  const otherRevenue = Math.max(0, Math.round(revenueTotal - gdp * coreRevenueGdpShare));
  const debtPrincipal = Math.round(gdp * profile.debtShare);
  const debtInterest = Math.round(debtPrincipal * 0.08);
  // The published total includes debt service; the budget constructor adds
  // interest separately, so allocate only the remaining operating envelope.
  const allocations = allocateTransitionFiscal1991(
    Math.max(0, expenditureTotal - debtInterest),
    spendingShares
  );
  const prefix = countryId.toLowerCase();
  const taxPolicyIds =
    countryId === "RU"
      ? {
          incomeTax: "ru.tax.incomeTax",
          domesticCorporateTax: "ru.tax.domesticCorporateTax",
          foreignCorporateTax: "ru.tax.foreignCorporateTax",
          payrollTax: "ru.tax.payrollTax",
          tariffs: "ru.tax.tariffs",
          salesTax: "ru.tax.salesTax",
        }
      : easternBlocPolicyConfig(prefix).taxPolicyIds;
  return {
    budgetId: countryId,
    countryId,
    fiscalYear: 1991,
    population,
    gdp,
    currencyCode: profile.currencyCode,
    economicFactors: {
      gdpGrowth: profile.growth,
      wageGrowth: profile.inflation + profile.growth,
      inflationRate: profile.inflation,
      tradeGrowth: -5,
      lastUpdated: new Date(0),
    },
    taxBaseRatios,
    otherRevenue,
    debt: {
      principal: debtPrincipal,
      interestRate: 0.08,
      ceiling: Math.round(debtPrincipal * 1.5),
      ceilingLastRaisedYear: 1991,
    },
    creditRating: profile.rating,
    baselineSpendingByCategory: Object.fromEntries(
      Object.entries(allocations).filter(([key]) => key !== "stateGrants")
    ),
    baselineStateGrants: allocations.stateGrants,
    policyDefaults: {},
    policyOptionOverrides: {},
    taxPolicyIds,
    taxRateOverrides,
  };
});
