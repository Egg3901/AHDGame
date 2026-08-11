/**
 * Semantic-token tone maps for the political-metrics dashboard.
 *
 * Score tone = objective performance (status bands). Lean tone = political
 * association only (left ↔ right), deliberately expressed through the game's
 * secondary (blue) / primary (red) identity at graded opacity — never a
 * good/bad ramp, per the catalog's "association, not quality" rule.
 */

export interface Tone {
  text: string;
  bg: string;
  border: string;
}

/** Status-band tone (thresholds match STATUS_BANDS in the catalog). */
export function scoreTone(score: number): Tone {
  if (score >= 85) return { text: "text-gold", bg: "bg-gold", border: "border-gold" };
  if (score >= 70) return { text: "text-success", bg: "bg-success", border: "border-success" };
  if (score >= 55)
    return {
      text: "text-success-muted",
      bg: "bg-success-muted",
      border: "border-success-muted",
    };
  if (score >= 40) return { text: "text-warning", bg: "bg-warning", border: "border-warning" };
  if (score >= 25)
    return {
      text: "text-warning-muted",
      bg: "bg-warning-muted",
      border: "border-warning-muted",
    };
  return { text: "text-error", bg: "bg-error", border: "border-error" };
}

/** Political-association tone: blue (left) ↔ muted (mixed) ↔ red (right). */
export function leanTone(lean: number): Tone {
  if (lean <= -5)
    return { text: "text-secondary", bg: "bg-secondary/15", border: "border-secondary" };
  if (lean <= -3)
    return { text: "text-secondary/80", bg: "bg-secondary/10", border: "border-secondary/70" };
  if (lean < 0)
    return { text: "text-secondary/60", bg: "bg-secondary/5", border: "border-secondary/40" };
  if (lean === 0) return { text: "text-muted", bg: "bg-muted/10", border: "border-muted" };
  if (lean <= 1)
    return { text: "text-primary/60", bg: "bg-primary/5", border: "border-primary/40" };
  if (lean <= 3)
    return { text: "text-primary/80", bg: "bg-primary/10", border: "border-primary/70" };
  return { text: "text-primary", bg: "bg-primary/15", border: "border-primary" };
}
