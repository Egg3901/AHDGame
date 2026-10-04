import type { NationalBudgetSeedConfig } from "./budgets";
import { MODERN_2019_NATIONALS, type Modern2019CountryId } from "./modernRegions2019";
import { modernMetrics2019 } from "./modernMetrics2019";
import { easternBlocPolicyConfig } from "@/lib/seeds/shared/easternBlocLegislation";

/**
 * Observed 2019 general-government shares and gross debt. The four EU rows
 * are Eurostat's October 2021 national-currency table, 2019 column; RU is
 * the IMF 2019 Article IV forecast, so its ratios are estimates rather than
 * subsequently revised outturns.
 * https://ec.europa.eu/eurostat/documents/2995521/11563331/2-21102021-AP-EN.pdf/257365fa-8a66-cab8-f60c-06ca9c916a7a
 * https://www.imf.org/-/media/files/publications/cr/2019/1rusea2019001.pdf
 *
 * Tax bases, effective opening rates, functional spending allocation, debt
 * service rate and ceiling are game calibrations, not observed statute or
 * function-level national accounts. The category split sums to the reported
 * expenditure after modeled interest, and other receipts close to reported
 * revenue. Every monetary field remains in that country's 2019 currency.
 */
const FISCAL = {
  RU: {
    currencyCode: "RUB",
    revenue: 34.7,
    expenditure: 33.3,
    debtRatio: 15.8,
    interest: 0.06,
    inflation: 4.47,
    rating: "BBB",
  },
  PL: {
    currencyCode: "PLN",
    revenue: 41.0,
    expenditure: 41.8,
    debt: 1_045_865_000_000,
    interest: 0.03,
    inflation: 2.23,
    rating: "A",
  },
  HU: {
    currencyCode: "HUF",
    revenue: 43.6,
    expenditure: 45.7,
    debt: 31_130_527_000_000,
    interest: 0.04,
    inflation: 3.34,
    rating: "BBB",
  },
  RO: {
    currencyCode: "RON",
    revenue: 31.9,
    expenditure: 36.3,
    debt: 373_497_000_000,
    interest: 0.04,
    inflation: 3.83,
    rating: "BBB",
  },
  BG: {
    currencyCode: "BGN",
    revenue: 37.6,
    expenditure: 35.5,
    debt: 24_085_000_000,
    interest: 0.02,
    inflation: 3.1,
    rating: "BBB",
  },
} as const;

const taxBaseRatios = {
  taxableIncome: 0.4,
  corporateProfits: 0.2,
  wagesAndSalaries: 0.4,
  importValue: 0.15,
  taxableSales: 0.7,
};
const taxRateOverrides = {
  incomeTax: 12,
  domesticCorporateTax: 35,
  foreignCorporateTax: 35,
  payrollTax: 20,
  tariffs: 5,
  salesTax: 16,
};
const coreRevenueShare =
  (taxBaseRatios.taxableIncome * taxRateOverrides.incomeTax +
    taxBaseRatios.corporateProfits * taxRateOverrides.domesticCorporateTax +
    taxBaseRatios.wagesAndSalaries * taxRateOverrides.payrollTax +
    taxBaseRatios.importValue * taxRateOverrides.tariffs +
    taxBaseRatios.taxableSales * taxRateOverrides.salesTax) /
  100;
const spendingShares = {
  healthcare: 0.11,
  education: 0.12,
  defense: 0.08,
  socialSecurity: 0.28,
  infrastructure: 0.2,
  other: 0.11,
  stateGrants: 0.1,
} as const;

export const MODERN_NATIONAL_BUDGETS_2019: NationalBudgetSeedConfig[] = (
  Object.keys(FISCAL) as Modern2019CountryId[]
).map((countryId) => {
  const fiscal = FISCAL[countryId];
  const { population, gdp } = MODERN_2019_NATIONALS[countryId];
  const debtPrincipal = "debt" in fiscal ? fiscal.debt : Math.round((gdp * fiscal.debtRatio) / 100);
  const operating = Math.round((gdp * fiscal.expenditure) / 100 - debtPrincipal * fiscal.interest);
  const allocations = Object.fromEntries(
    Object.entries(spendingShares).map(([category, share]) => [
      category,
      Math.round(operating * share),
    ])
  );
  const growth = modernMetrics2019(countryId)[0]!.economic.gdpGrowth.value;
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
      : easternBlocPolicyConfig(countryId.toLowerCase()).taxPolicyIds;
  return {
    budgetId: countryId,
    countryId,
    fiscalYear: 2019,
    population,
    gdp,
    currencyCode: fiscal.currencyCode,
    economicFactors: {
      gdpGrowth: growth,
      wageGrowth: growth + fiscal.inflation,
      inflationRate: fiscal.inflation,
      tradeGrowth: growth,
      lastUpdated: new Date(0),
    },
    taxBaseRatios,
    otherRevenue: Math.max(0, Math.round(gdp * (fiscal.revenue / 100 - coreRevenueShare))),
    debt: {
      principal: debtPrincipal,
      interestRate: fiscal.interest,
      ceiling: Math.round(debtPrincipal * 1.5),
      ceilingLastRaisedYear: 2019,
    },
    creditRating: fiscal.rating,
    baselineSpendingByCategory: Object.fromEntries(
      Object.entries(allocations).filter(([key]) => key !== "stateGrants")
    ),
    baselineStateGrants: allocations.stateGrants,
    policyDefaults: {},
    policyOptionOverrides: {},
    skipLegacyLegislation: true,
    taxPolicyIds,
    taxRateOverrides,
  };
});
