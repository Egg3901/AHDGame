import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";
import { currencySymbolSep } from "@/lib/currency/symbolSep";
export { currencySymbolSep } from "@/lib/currency/symbolSep";

/**
 * Resolve a currency code to its display symbol (¥, $, £, €, ₦, …), falling back
 * to the code itself for anything unmapped. Local currency only — never ₳.
 */
export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency as CurrencyCode] ?? currency;
}

/**
 * Format a National Corporation amount in its local currency with the symbol
 * (e.g. ¥0, $1,200, -¥7,300,000). The minus sign leads the symbol.
 */
export function natMoney(n: number, currency: string): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  const sym = currencySymbol(currency);
  // Pin en-US: the rest of the National Corporation cards format with an explicit
  // "en-US" locale (comma thousands separator). A bare toLocaleString() used the
  // runtime locale, so the same magnitude rendered "1,500" on one line and "1.500"
  // on the adjacent Modernization line in dot-separator locales (ticket #1072).
  return `${sign}${sym}${currencySymbolSep(sym)}${Math.abs(rounded).toLocaleString("en-US")}`;
}
