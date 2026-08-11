/**
 * Returns a separator to place between a currency symbol and its number.
 * Multi-character purely-alphabetic symbols (e.g. "руб", "lei", "din") look
 * wrong when run directly into the digit — "руб0" — so they get a space.
 */
export function currencySymbolSep(sym: string): string {
  return sym.length >= 3 && /^[a-zA-ZÀ-ɏЀ-ӿ]+$/i.test(sym) ? " " : "";
}
