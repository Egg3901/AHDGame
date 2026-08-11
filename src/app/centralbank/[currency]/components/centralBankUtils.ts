import type { CreditRating } from "@/lib/db/types/centralBank";
import type { CurrencyCode } from "@/lib/constants/currencies";

export function ratingColor(rating: CreditRating): string {
  switch (rating) {
    case "AAA":
      return "bg-success/20 text-success";
    case "AA":
      return "bg-success/15 text-success";
    case "A":
      return "bg-success/10 text-success";
    case "BBB":
      return "bg-warning/15 text-warning";
    case "BB":
      return "bg-warning/20 text-warning";
    case "B":
      return "bg-error/15 text-error";
    case "CCC":
      return "bg-error/20 text-error";
  }
}

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
