import { getEraAwareCurrencySymbol, type CurrencyCode } from "@/lib/constants/currencies";
import { formatSharePrice } from "@/lib/utils/formatters";

/**
 * One authoritative share quote: the price a corporation's shares trade at, in
 * the currency of the exchange they list on.
 *
 * Every equity price surface (corporation header, market tape, stocks table,
 * status bar) prints the stored listing-currency price through this function,
 * with no forex round trip. Converting to the anchor and back made the same
 * quote read differently on each surface, because each one converted with a
 * different rate (snapshot time versus live) or a different display preference.
 * Cross-currency sorting keeps using the anchor mirrors; only the printed quote
 * is pinned here.
 *
 * Pure: no context, clock, or rates.
 */
export function formatListingQuote(
  localPrice: number,
  currencyCode: CurrencyCode,
  preset: string,
  eurozoneEnabled: boolean
): string {
  return formatSharePrice(
    localPrice,
    getEraAwareCurrencySymbol(currencyCode, preset, eurozoneEnabled)
  );
}

/**
 * The as-of note under a quote board: the game turn the snapshot belongs to,
 * when known. Returns null when there is nothing to say.
 */
export function quoteTurnLabel(turn: number | null | undefined): string | null {
  if (turn == null || !Number.isFinite(turn) || turn <= 0) return null;
  return `turn ${Math.floor(turn).toLocaleString("en-US")}`;
}
