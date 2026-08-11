/**
 * Small presentational helpers for the World Trade Ledger. Direction is always
 * conveyed with a glyph (▲/▼/—) AND a semantic tone token, never color alone.
 */

/** ▲ for surplus, ▼ for deficit, — for balanced. */
export function directionMark(net: number): "▲" | "▼" | "—" {
  if (net > 0) return "▲";
  if (net < 0) return "▼";
  return "—";
}

/** Semantic tone class for a signed value. */
export function directionToneClass(net: number): string {
  if (net > 0) return "text-success";
  if (net < 0) return "text-error";
  return "text-muted";
}

/** Verdict stamp tone — gold accent for imbalanced, success for balanced. */
export function verdictToneClass(verdict: "BALANCED" | "IMBALANCED"): string {
  return verdict === "IMBALANCED" ? "text-primary" : "text-success";
}
