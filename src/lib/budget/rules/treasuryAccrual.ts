/** Named components of the existing signed treasury accrual, without new cash rules. */
import type { TreasuryAccrualReceipt } from "@/lib/db/types/budget";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  COUNTRY_CURRENCY_MAP,
  FOREX_ACTIVE_COUNTRIES,
  eraRateForCurrency,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import type { LedgerLeg } from "@/lib/ledger/types";

export function treasuryAccrualReceipt(
  input: Omit<TreasuryAccrualReceipt, "cashDelta" | "components"> & {
    annualRevenue: number;
    annualPrimarySpending: number;
    debtService: number;
    enforcement: number;
  }
): TreasuryAccrualReceipt {
  const { annualRevenue, annualPrimarySpending, debtService, enforcement, ...context } = input;
  const revenue = annualRevenue / TURNS_PER_YEAR;
  const primarySpending = annualPrimarySpending / TURNS_PER_YEAR;
  const rawDelta = revenue - primarySpending - debtService - enforcement;
  // Preserve the existing operation order and whole-unit treasury rounding.
  const primaryPerTurn = (annualRevenue - annualPrimarySpending) / TURNS_PER_YEAR;
  const cashDelta =
    Math.round(input.openingCash + primaryPerTurn - debtService - enforcement) - input.openingCash;
  return {
    ...context,
    cashDelta,
    components: {
      revenue,
      primarySpending: -primarySpending,
      debtService: -debtService,
      enforcement: -enforcement,
      rounding: cashDelta - rawDelta,
    },
  };
}

export function treasuryAccrualLegs(
  countryId: string,
  receipt: TreasuryAccrualReceipt
): LedgerLeg[] {
  if (receipt.anchorRate === null)
    throw new Error("Unpriced treasury receipt cannot publish anchor legs");
  const legs: LedgerLeg[] = [];
  const reasons = {
    revenue: "fiscal_revenue",
    primarySpending: "fiscal_primary_spending",
    debtService: "fiscal_debt_service",
    enforcement: "fiscal_union_enforcement",
    rounding: "fiscal_cash_rounding",
  };
  for (const [key, amount] of Object.entries(receipt.components)) {
    if (amount === 0) continue;
    const currency = receipt.currencyCode;
    legs.push({
      account: `government:${countryId}:${currency}`,
      amount,
      currencyCode: currency,
      anchorAmount: amount / receipt.anchorRate,
      role: "primary",
    });
    legs.push({
      account: `${amount > 0 ? "mint" : "sink"}:${reasons[key as keyof typeof reasons]}:${currency}`,
      amount: -amount,
      currencyCode: currency,
      anchorAmount: -amount / receipt.anchorRate,
      role: "contra",
    });
  }
  return legs;
}

/** Native fiscal cash needs valuation, never a synthetic tradable FX quote. */
export function treasuryAnchorValuation(input: {
  countryId: string;
  currencyCode: CurrencyCode;
  preset: string;
  observedRate: number | undefined;
}): {
  anchorRate: number;
  anchorRateSource: "observed" | "authored_budget_only";
  anchorRatePreset: string;
} {
  const { countryId, currencyCode, preset, observedRate } = input;
  if (observedRate !== undefined) {
    if (Number.isFinite(observedRate) && observedRate > 0)
      return { anchorRate: observedRate, anchorRateSource: "observed", anchorRatePreset: preset };
  } else if (
    !FOREX_ACTIVE_COUNTRIES.includes(countryId as CountryId) &&
    COUNTRY_CURRENCY_MAP[countryId as CountryId] === currencyCode
  ) {
    const authored = eraRateForCurrency(currencyCode, preset);
    if (authored !== undefined && Number.isFinite(authored) && authored > 0)
      return {
        anchorRate: authored,
        anchorRateSource: "authored_budget_only",
        anchorRatePreset: preset,
      };
  }
  throw new Error(`Missing valid treasury-accrual exchange rate for ${currencyCode}`);
}
