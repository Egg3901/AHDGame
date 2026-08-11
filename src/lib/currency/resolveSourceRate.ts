import type { CurrencyCode } from "@/lib/constants/currencies";
import type { DisplayCurrencyPreference } from "@/lib/utils/formatters";

type RateMap = Partial<Record<CurrencyCode, number>>;

/**
 * Resolve the exchange rate that maps "the currency the player is actively
 * looking at" → internal (₳) units. The result is the divisor used when a
 * player-entered display amount must be converted back to internal storage.
 *
 * This mirrors the lookup in `resolveDisplay`: whatever currency the UI is
 * showing must match what we assume the input is denominated in, or
 * round-tripping breaks (typing 50,000 in USD and having the server read it
 * as 50,000 JPY was the concrete bug driving this helper).
 *
 *   - "internal": rate 1 (₳ is the input unit)
 *   - "home" / "local": rate for the player's home country currency
 *   - CurrencyCode (e.g. "USD"): rate for that specific currency
 *   - Missing pinned CurrencyCode rates fall back to 1, keeping the input
 *     denomination aligned with the pinned display instead of switching to home
 */
export function resolveSourceRate(
  preference: DisplayCurrencyPreference,
  homeCurrencyCode: CurrencyCode,
  rates: RateMap | null
): number {
  if (preference === "internal") return 1;
  if (!rates) return 1;

  if (preference === "home" || preference === "local") {
    return rates[homeCurrencyCode] ?? 1;
  }

  // Pinned CurrencyCode ("USD", "GBP", "JPY", "CAD", "EUR")
  const pinnedRate = rates[preference];
  if (pinnedRate !== undefined) return pinnedRate;

  // Keep the typed denomination consistent with the pinned display. Falling
  // back to home here makes a missing EUR rate behave like CNY for China users.
  return 1;
}
