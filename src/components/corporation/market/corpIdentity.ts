/** Pure identity/derivation helpers for the player-corp market masthead. */

export function deriveTicker(corp: { tickerSymbol?: string | null; name: string }): string {
  const explicit = (corp.tickerSymbol ?? "").trim().toUpperCase();
  if (explicit) return explicit;

  const words = corp.name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean);

  if (words.length === 0) return "CORP";
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words
    .map((w) => w[0])
    .join("")
    .slice(0, 5)
    .toUpperCase();
}

export function computeDayChange(
  history: Array<{ sharePrice: number }>
): { changePct: number; prevClose: number } | null {
  if (!history || history.length < 2) return null;
  const prevClose = history[history.length - 2].sharePrice;
  const last = history[history.length - 1].sharePrice;
  const changePct = prevClose > 0 ? ((last - prevClose) / prevClose) * 100 : 0;
  return { changePct, prevClose };
}
