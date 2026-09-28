/**
 * Currency displays preserve the denomination of stored balances. Local displays
 * may translate a German accounting unit into marks or Irish pounds into euros;
 * displayQuote returns the same rate used to interpret a player's input.
 */
import {
  CURRENCY_ANCHOR_COUNTRY,
  getEraAwareCurrencySymbol,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import type { DisplayCurrencyPreference } from "@/lib/utils/formatters";

export type DisplayRates = Partial<Record<CurrencyCode, number>>;
export interface CurrencyDisplayContext {
  preset: string;
  eurozoneEnabled: boolean;
}

// Matches the normalization of INITIAL_RATES_1991 and the other German era rates.
// https://economy-finance.ec.europa.eu/euro/eu-countries-and-euro/germany-and-euro_en
export const MARKS_PER_EURO_ACCOUNTING_UNIT = 1.95583;
const PRE_EURO_PRESETS = new Set(["1953-default", "1979-default", "1991-default"]);

export function validDisplayRate(rate: number | undefined): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

/** Rate is displayed units per shared accounting unit, never a ledger mutation. */
export function displayQuote(params: {
  preference: DisplayCurrencyPreference;
  homeCurrency: CurrencyCode;
  nativeCurrency?: CurrencyCode;
  rates: DisplayRates | null;
  baseRates?: DisplayRates | null;
  context: CurrencyDisplayContext;
}): { rate: number; symbol: string } {
  const { preference, homeCurrency, nativeCurrency, rates, baseRates, context } = params;
  if (preference === "internal" || !rates) return { rate: 1, symbol: "₳" };
  const local = preference === "home" || preference === "local";
  let code = local
    ? preference === "local"
      ? (nativeCurrency ?? homeCurrency)
      : homeCurrency
    : preference;
  // The IEP ledger stays IEP. Displaying euros reads the actual EUR quotation.
  if (local && code === "IEP" && context.eurozoneEnabled) code = "EUR";
  const live = rates[code];
  const rate = validDisplayRate(live) ? live : baseRates?.[code];
  if (!validDisplayRate(rate)) return { rate: 1, symbol: "₳" };
  if (local && code === "EUR") {
    // Rate calibration is not uniform across presets: 1953 stores marks,
    // while 1979/1991 already divide the mark rate by 1.95583.
    const marksPerLedgerUnit =
      context.preset === "1953-default" ? 1 : MARKS_PER_EURO_ACCOUNTING_UNIT;
    if (!context.eurozoneEnabled && PRE_EURO_PRESETS.has(context.preset)) {
      return { rate: rate * marksPerLedgerUnit, symbol: "DM" };
    }
    return { rate: (rate * marksPerLedgerUnit) / MARKS_PER_EURO_ACCOUNTING_UNIT, symbol: "€" };
  }
  return {
    rate,
    symbol: getEraAwareCurrencySymbol(
      code,
      context.preset,
      context.eurozoneEnabled,
      CURRENCY_ANCHOR_COUNTRY[code]
    ),
  };
}
