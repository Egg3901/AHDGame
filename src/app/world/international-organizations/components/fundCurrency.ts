/** Currency symbols for the org-fund display (founding-country currency). */
const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  BRL: "R$",
  NGN: "₦",
};

/** Symbol for a currency code, falling back to the code itself + a space. */
export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOL[code] ?? `${code} `;
}

/** Compact fund amount: `€1.20T` / `$340B` / `£5.0M`, given a full (non-millions) amount. */
export function formatFundAmount(amount: number, currencyCode: string): string {
  const sym = currencySymbol(currencyCode);
  const millions = amount / 1_000_000;
  const abs = Math.abs(millions);
  if (abs >= 1_000_000) return `${sym}${(millions / 1_000_000).toFixed(2)}T`;
  if (abs >= 1_000) return `${sym}${(millions / 1_000).toFixed(0)}B`;
  if (abs >= 1) return `${sym}${millions.toFixed(1)}M`;
  return `${sym}${Math.round(amount).toLocaleString()}`;
}
