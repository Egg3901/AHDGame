import type { CurrencyCode } from "@/lib/constants/currencies";

export function formatNativeCurrency(amount: number, currency: CurrencyCode): string {
  const sym =
    ({ USD: "$", GBP: "£", JPY: "¥", CAD: "C$", EUR: "€" } as Record<string, string>)[currency] ??
    currency;
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  const fixedDigits = currency === "JPY" ? 0 : 2;
  const compact = (n: number, suffix: string, divisor: number) =>
    `${sign}${sym}${(n / divisor).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}${suffix}`;
  if (abs >= 1_000_000_000) return compact(abs, "B", 1_000_000_000);
  if (abs >= 1_000_000) return compact(abs, "M", 1_000_000);
  if (abs >= 10_000) return compact(abs, "K", 1_000);
  return `${sign}${sym}${abs.toLocaleString(undefined, {
    minimumFractionDigits: fixedDigits,
    maximumFractionDigits: fixedDigits,
  })}`;
}
