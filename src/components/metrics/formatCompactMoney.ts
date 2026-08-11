import { currencySymbolSep } from "@/lib/currency/symbolSep";

/**
 * Compact local-currency formatter for masthead tiles, e.g. "£2.70T", "$72.5K".
 * `value` is in base currency units; `symbol` is the local currency prefix.
 */
export function formatCompactMoney(symbol: string, value: number): string {
  const sign = value < 0 ? "-" : "";
  const v = Math.abs(value);
  let body: string;
  if (v >= 1e12) body = (v / 1e12).toFixed(2) + "T";
  else if (v >= 1e9) body = (v / 1e9).toFixed(2) + "B";
  else if (v >= 1e6) body = (v / 1e6).toFixed(1) + "M";
  else if (v >= 1e3) body = (v / 1e3).toFixed(1) + "K";
  else body = String(Math.round(v));
  return `${sign}${symbol}${currencySymbolSep(symbol)}${body}`;
}
