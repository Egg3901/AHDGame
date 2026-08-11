import type { CurrencyCode } from "@/lib/constants/currencies";

/** Returns normalized amount or null if invalid. */
export function normalizeSavingsMutationAmount(
  amount: number,
  currency: CurrencyCode
): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (currency === "JPY") {
    const n = Math.round(amount);
    return n > 0 ? n : null;
  }
  const n = Math.round(amount * 100) / 100;
  return n >= 0.01 ? n : null;
}
