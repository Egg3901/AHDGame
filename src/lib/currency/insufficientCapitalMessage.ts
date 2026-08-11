import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";

/**
 * Player-facing "Insufficient capital" error for corporation spend gates.
 *
 * Both amounts MUST already be in the corp's local (`liquidCurrencyCode`)
 * currency — convert any ₳/anchor internal value back to local before calling.
 * The symbol is resolved from `currencyCode` so a JP corp reads ¥, a UK corp £,
 * etc., never a hardcoded "$" on a non-USD corp. Unknown / pre-forex codes
 * fall back to "$" (USD parity), matching the legacy anchor display.
 */
export function insufficientCapitalMessage(
  costNoun: string,
  costLocal: number,
  haveLocal: number,
  currencyCode: CurrencyCode | string | null | undefined
): string {
  const sym = (currencyCode && CURRENCY_SYMBOLS[currencyCode as CurrencyCode]) || "$";
  return (
    `Insufficient capital. ${costNoun} costs ${sym}${Math.round(costLocal).toLocaleString()}. ` +
    `You have ${sym}${Math.round(haveLocal).toLocaleString()}.`
  );
}
