/**
 * SEED_TAX_RATES_1953 — the spec-owned authored table of 1953 EFFECTIVE tax rates
 * (design spec §4.2a). The reset seed writes these into federalBudget.taxRates for
 * US/UK/RU/DD, and every tax law's baselineRate must equal its entry (validated), so
 * day-one receipts reconcile by construction.
 *
 * Provenance: US/UK = COUNTRY_POLICY_CONFIGS_1953 option indexes × the old
 * taxRateOptions ladders; RU = hand-authored against the ruling-#15 budget through
 * the authored taxBaseRatios (turnover-tax anchor ≈₽240B).
 */

import type { LawCountryId } from "./types";

export const SEED_TAX_TYPES = [
  "incomeTax",
  "domesticCorporateTax",
  "foreignCorporateTax",
  "payrollTax",
  "salesTax",
  "tariffs",
] as const;
export type SeedTaxType = (typeof SEED_TAX_TYPES)[number];

export const SEED_TAX_RATES_1953: Record<LawCountryId, Record<SeedTaxType, number>> = {
  US: {
    incomeTax: 35,
    domesticCorporateTax: 40,
    foreignCorporateTax: 32,
    payrollTax: 3,
    salesTax: 0,
    tariffs: 0,
  },
  UK: {
    incomeTax: 36,
    domesticCorporateTax: 35,
    foreignCorporateTax: 39,
    payrollTax: 7.2,
    salesTax: 0,
    tariffs: 0,
  },
  RU: {
    incomeTax: 9,
    domesticCorporateTax: 60,
    foreignCorporateTax: 60,
    payrollTax: 5,
    salesTax: 31, // turnover tax — the revenue anchor
    tariffs: 0,
  },
  DD: {
    incomeTax: 12, // wage tax — a real (if modest) direct levy
    domesticCorporateTax: 60, // VEB profit remittance
    foreignCorporateTax: 60,
    payrollTax: 8, // social-insurance contribution share
    salesTax: 28, // product levy — the revenue anchor
    tariffs: 0,
  },
  DE: {
    incomeTax: 12,
    domesticCorporateTax: 60,
    foreignCorporateTax: 60,
    payrollTax: 8,
    salesTax: 28,
    tariffs: 0,
  },
};
