import type { CurrencyCode } from "@/lib/constants/currencies";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";

type RateMap = Partial<Record<CurrencyCode, number>>;

/**
 * Baseline local-units-per-anchor by currency, derived from each country's
 * `usdExchangeRate` (₳ per local unit; the anchor trades ≈1:1 with the era's
 * dollar). Fallback source only — live forex rates always win when loaded.
 *
 * ERA-SCOPED (refs #3778). The fallback is not dead code in a pre-1999 world:
 * the Warsaw-Pact currencies (HUF/PLZ/ROL/YUD/BGL/CSK) are deliberately outside
 * `FOREX_ACTIVE_COUNTRIES`, so `exchangeRates` never carries a row for them and
 * every display of a bloc economy lands here. Built from the base config it
 * priced a 1953 world with 1979 rates.
 */
const localPerAnchorByPreset = new Map<string, Partial<Record<CurrencyCode, number>>>();

function localPerAnchorFor(preset?: string): Partial<Record<CurrencyCode, number>> {
  const key = preset ?? "";
  const cached = localPerAnchorByPreset.get(key);
  if (cached) return cached;
  const map: Partial<Record<CurrencyCode, number>> = {};
  for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
    const config = getCountryConfig(countryId, preset);
    if (config?.currencyCode && map[config.currencyCode] === undefined) {
      const anchorPerLocal = config.usdExchangeRate;
      if (anchorPerLocal > 0) map[config.currencyCode] = 1 / anchorPerLocal;
    }
  }
  localPerAnchorByPreset.set(key, map);
  return map;
}

/**
 * Resolve (display value, symbol) for force-formatting an internal amount in a
 * specific currency, ignoring the viewer's `displayCurrencyPreference`.
 *
 * Used by economy-anchored displays (sector market size, regional GDP totals)
 * where the underlying number represents an economy — not a wallet — and
 * should not wobble turn-over-turn with forex drift on the viewer's preferred
 * currency.
 *
 * When live rates are unavailable (forex disabled or pre-load) or the
 * requested currency has no rate entry, falls back to the currency's BASELINE
 * rate so the amount still reads in local units — the anchor symbol is an
 * internal convention and never shown player-facing.
 */
export function resolveForcedDisplay(
  internalAmount: number,
  currencyCode: CurrencyCode,
  rates: RateMap | null,
  /** Active world preset, so the BASELINE fallback is the era's rate, not 2019's. */
  preset?: string
): { value: number; symbol: string } {
  const rate = rates?.[currencyCode] ?? localPerAnchorFor(preset)[currencyCode];
  if (rate === undefined) {
    // Unknown currency with no baseline either — last-resort anchor passthrough.
    return { value: internalAmount, symbol: "₳" };
  }
  return { value: internalAmount * rate, symbol: CURRENCY_SYMBOLS[currencyCode] ?? "$" };
}
