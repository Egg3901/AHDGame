/**
 * Budget calculation utilities
 * - Recalculate revenue from tax bases and rates
 * - Apply economic growth to tax bases
 * - Currency display helpers
 *
 * **Currency (v0.2.6):** All math here is intra-country. `taxBases` are in the
 * owning country's currency (see `db/types/budget.ts`), `taxRates` are
 * percentages, so revenue figures inherit the country currency. The
 * `otherRevenue` default parameter is a placeholder constant — callers should
 * pass a country-local value when invoking this helper for non-US budgets.
 * No cross-country aggregation, so no FX conversion is performed.
 */

import type {
  FederalBudget,
  FederalRevenue,
  FederalTaxBases,
  FederalTaxRates,
  StateBudget,
  StateRevenue,
  StateTaxBases,
  StateTaxRates,
  EconomicGrowthFactors,
} from "@/lib/db/types/budget";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Calculate federal revenue from tax bases and rates
 */
export function calculateFederalRevenue(
  bases: FederalTaxBases,
  rates: FederalTaxRates,
  otherRevenue: number = 200000000000,
  healthcareIncome: number = 0,
  gdp: number = 0
): FederalRevenue {
  const incomeTax = bases.taxableIncome * (rates.incomeTax / 100);
  const domesticCorporateTax = bases.domesticCorporateProfits * (rates.domesticCorporateTax / 100);
  const foreignCorporateTax = bases.foreignCorporateProfits * (rates.foreignCorporateTax / 100);
  const payrollTax = bases.wagesAndSalaries * (rates.payrollTax / 100);
  // UI-only estimate on the GDP proxy. The live booking path (budget/revenue.ts)
  // nets this against real sourced import flow when interstateMoneyWiringEnabled
  // is on; this client-side display helper intentionally stays on the proxy.
  const tariffs = bases.importValue * (rates.tariffs / 100);
  const salesTax = bases.taxableSales * (rates.salesTax / 100);
  // DE Solidaritätszuschlag — surcharge on income tax owed. Other countries: rates.solidaritySurcharge undefined/0.
  const solidaritySurcharge = incomeTax * ((rates.solidaritySurcharge ?? 0) / 100);
  // CN LVAT (土地增值税) — applied to a real-estate-sector proxy
  // (5% of domestic corporate profits, as a v1 approximation for real-estate-firm profits).
  // Non-CN: rate undefined → 0.
  const lvatBase = bases.domesticCorporateProfits * 0.05;
  const landValueAddedTax = lvatBase * ((rates.landValueAddedTax ?? 0) / 100);
  // CN UMCT (城市维护建设税) — surcharge on VAT (salesTax) receipts. Non-CN: rate undefined → 0.
  const urbanMaintenanceTax = salesTax * ((rates.urbanMaintenanceTax ?? 0) / 100);
  // CN Stamp Duty (印花税) — applied to a GDP-derived documented-transactions proxy (2% of GDP).
  // Non-CN: rate undefined → 0.
  const stampDutyBase = gdp * 0.02;
  const stampDuty = stampDutyBase * ((rates.stampDuty ?? 0) / 100);

  return {
    incomeTax,
    domesticCorporateTax,
    foreignCorporateTax,
    payrollTax,
    tariffs,
    salesTax,
    solidaritySurcharge,
    landValueAddedTax,
    urbanMaintenanceTax,
    stampDuty,
    healthcareIncome,
    other: otherRevenue,
    total:
      incomeTax +
      domesticCorporateTax +
      foreignCorporateTax +
      payrollTax +
      tariffs +
      salesTax +
      solidaritySurcharge +
      landValueAddedTax +
      urbanMaintenanceTax +
      stampDuty +
      healthcareIncome +
      otherRevenue,
  };
}

/**
 * Calculate state revenue from tax bases and rates
 */
export function calculateStateRevenue(
  bases: StateTaxBases,
  rates: StateTaxRates,
  federalGrants: number,
  otherRevenue: number = 0
): StateRevenue {
  const incomeTax = bases.taxableIncome * (rates.incomeTax / 100);
  const salesTax = bases.taxableSales * (rates.salesTax / 100);
  const domesticCorporateTax = bases.domesticCorporateProfits * (rates.domesticCorporateTax / 100);
  const foreignCorporateTax = bases.foreignCorporateProfits * (rates.foreignCorporateTax / 100);
  const propertyTax = bases.propertyValue * (rates.propertyTax / 100);
  // DE Gewerbesteuer — Hebesatz (200-600) × Steuermesszahl (0.035) × corporate profit base.
  // Other countries: rates.tradeTax undefined/0 → no contribution.
  const tradeTax = bases.domesticCorporateProfits * 0.035 * ((rates.tradeTax ?? 0) / 100);

  return {
    incomeTax,
    salesTax,
    domesticCorporateTax,
    foreignCorporateTax,
    propertyTax,
    tradeTax,
    federalGrants,
    other: otherRevenue,
    total:
      incomeTax +
      salesTax +
      domesticCorporateTax +
      foreignCorporateTax +
      propertyTax +
      tradeTax +
      federalGrants +
      otherRevenue,
  };
}

/**
 * Apply economic growth to federal tax bases
 * @param bases Current tax bases
 * @param factors Economic growth factors
 * @param turnsElapsed Number of game turns (each turn = 1 month)
 * @returns Updated tax bases
 */
export function growFederalTaxBases(
  bases: FederalTaxBases,
  factors: EconomicGrowthFactors,
  turnsElapsed: number = 1
): FederalTaxBases {
  // Convert annual rates to monthly rates
  const monthlyGdpGrowth = Math.pow(1 + factors.gdpGrowth / 100, 1 / 12) - 1;
  const monthlyWageGrowth = Math.pow(1 + factors.wageGrowth / 100, 1 / 12) - 1;
  const monthlyInflation = Math.pow(1 + factors.inflationRate / 100, 1 / 12) - 1;
  const monthlyTradeGrowth = Math.pow(1 + factors.tradeGrowth / 100, 1 / 12) - 1;

  // Compound growth over turns
  const gdpMultiplier = Math.pow(1 + monthlyGdpGrowth, turnsElapsed);
  const wageMultiplier = Math.pow(1 + monthlyWageGrowth, turnsElapsed);
  const inflationMultiplier = Math.pow(1 + monthlyInflation, turnsElapsed);
  const tradeMultiplier = Math.pow(1 + monthlyTradeGrowth, turnsElapsed);

  return {
    // Taxable income grows with wages + inflation
    taxableIncome: bases.taxableIncome * wageMultiplier * inflationMultiplier,
    // Corporate profits grow with GDP (domestic/foreign split grows uniformly)
    domesticCorporateProfits: bases.domesticCorporateProfits * gdpMultiplier,
    foreignCorporateProfits: bases.foreignCorporateProfits * gdpMultiplier,
    // Wages grow with wage growth
    wagesAndSalaries: bases.wagesAndSalaries * wageMultiplier,
    // Imports grow with trade
    importValue: bases.importValue * tradeMultiplier,
    // Consumer spending grows with wages + GDP
    taxableSales: bases.taxableSales * ((gdpMultiplier + wageMultiplier) / 2),
  };
}

/**
 * Apply economic growth to state tax bases (uses national growth factors)
 * @param bases Current state tax bases
 * @param factors National economic growth factors
 * @param turnsElapsed Number of game turns
 * @returns Updated tax bases
 */
export function growStateTaxBases(
  bases: StateTaxBases,
  factors: EconomicGrowthFactors,
  turnsElapsed: number = 1
): StateTaxBases {
  // Convert annual rates to monthly rates
  const monthlyGdpGrowth = Math.pow(1 + factors.gdpGrowth / 100, 1 / 12) - 1;
  const monthlyWageGrowth = Math.pow(1 + factors.wageGrowth / 100, 1 / 12) - 1;
  const monthlyInflation = Math.pow(1 + factors.inflationRate / 100, 1 / 12) - 1;

  // Compound growth over turns
  const gdpMultiplier = Math.pow(1 + monthlyGdpGrowth, turnsElapsed);
  const wageMultiplier = Math.pow(1 + monthlyWageGrowth, turnsElapsed);
  const inflationMultiplier = Math.pow(1 + monthlyInflation, turnsElapsed);

  // Property values grow slower (real estate appreciation)
  const propertyGrowthRate = (factors.gdpGrowth + factors.inflationRate) / 2;
  const monthlyPropertyGrowth = Math.pow(1 + propertyGrowthRate / 100, 1 / 12) - 1;
  const propertyMultiplier = Math.pow(1 + monthlyPropertyGrowth, turnsElapsed);

  return {
    taxableIncome: bases.taxableIncome * wageMultiplier * inflationMultiplier,
    taxableSales: bases.taxableSales * ((gdpMultiplier + wageMultiplier) / 2),
    domesticCorporateProfits: bases.domesticCorporateProfits * gdpMultiplier,
    foreignCorporateProfits: bases.foreignCorporateProfits * gdpMultiplier,
    propertyValue: bases.propertyValue * propertyMultiplier,
  };
}

/**
 * Recalculate federal budget with current tax bases and rates
 */
export function recalculateFederalBudget(budget: FederalBudget): FederalBudget {
  const newRevenue = calculateFederalRevenue(
    budget.taxBases,
    budget.taxRates,
    budget.revenue.other,
    budget.revenue.healthcareIncome,
    budget.gdp
  );

  const surplus = newRevenue.total - budget.spending.total;
  const debtToGdpRatio = budget.debt.principal / budget.gdp;

  return {
    ...budget,
    revenue: newRevenue,
    surplus,
    debtToGdpRatio,
    updatedAt: new Date(),
  };
}

/**
 * Recalculate state budget with current tax bases and rates
 */
export function recalculateStateBudget(budget: StateBudget): StateBudget {
  const newRevenue = calculateStateRevenue(
    budget.taxBases,
    budget.taxRates,
    budget.revenue.federalGrants,
    budget.revenue.other
  );

  const surplus = newRevenue.total - budget.spending.total;

  return {
    ...budget,
    revenue: newRevenue,
    surplus,
    updatedAt: new Date(),
  };
}

// ── Currency display helpers ─────────────────────────────────────────────────

/**
 * Get the display currency symbol for a country, optionally overridden by an
 * explicit currencyCode. Symbols come from the CURRENCY_SYMBOLS SSOT — a
 * local duplicate table here previously covered only 8 currencies, so every
 * era currency (SUR, FRF, ITL, ESP, SEK, TRL, DDM, the Eastern Bloc set)
 * silently displayed "$".
 */
export function getCurrencyPrefix(
  countryIdOrCurrencyCode?: string,
  explicitCurrencyCode?: string
): string {
  const code =
    explicitCurrencyCode ??
    COUNTRY_CURRENCY_MAP[(countryIdOrCurrencyCode ?? "") as CountryId] ??
    "USD";
  return CURRENCY_SYMBOLS[code as CurrencyCode] ?? "$";
}
