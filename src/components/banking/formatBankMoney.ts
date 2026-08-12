import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";

/** Compact face-value money for banking tables (no FX conversion). */
export function formatBankMoney(amount: number, currency: CurrencyCode): string {
  const sym = CURRENCY_SYMBOLS[currency] ?? currency;
  const n = Number.isFinite(amount) ? amount : 0;
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${sym}${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sym}${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sym}${(n / 1e6).toFixed(2)}M`;
  if (currency === "JPY" || currency === "SUR" || currency === "ITL") {
    return `${sym}${Math.round(n).toLocaleString("en-US")}`;
  }
  return `${sym}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function formatRatePercent(rate: number): string {
  if (!Number.isFinite(rate)) return "-";
  return `${rate.toFixed(2)}%`;
}
