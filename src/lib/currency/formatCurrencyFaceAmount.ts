import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { currencySymbolSep } from "@/lib/currency/symbolSep";

/**
 * Format an amount in a currency's natural face units (matches CurrencyWallet / forex tables).
 * Used for per-currency volumes and balances where the value is already in that currency's scale.
 */
export function formatCurrencyFaceAmount(amount: number, currency: CurrencyCode): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  const sep = currencySymbolSep(symbol);
  // Pin the locale to en-US so server (server locale) and client (browser
  // locale) render byte-identical output. Bare toLocaleString()/undefined uses
  // the runtime's locale, which differs on non-US browsers and triggers React
  // hydration error #418 ("text content did not match") on money displays.
  if (currency === "JPY") return `${symbol}${sep}${Math.round(amount).toLocaleString("en-US")}`;
  return `${symbol}${sep}${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
