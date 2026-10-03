/**
 * Semantic-token tone maps for the political-metrics registry.
 *
 * The registry's own views spend colour only where it means something:
 * `statusTextClass` for a bad status word and `healthTone` for democratic
 * health in its penalty range. Everything else stays neutral.
 *
 * `scoreTone` and `leanTone` are the older per-band ramps. The region compare
 * view and `LeanChip` still use them, so they stay exported unchanged.
 */

import { DEMOCRATIC_HEALTH_FALLOUT_THRESHOLD } from "@/lib/governanceStyle/rules/democraticConsequences";

export interface Tone {
  text: string;
  bg: string;
  border: string;
}

/**
 * Text colour for a status word ("Stable", "Strained" and so on, from
 * STATUS_BANDS). Keyed by the word itself rather than the score, so the colour
 * can never disagree with the word printed beside it at a band edge. Only the
 * genuinely bad bands are coloured: amber (the warning tone) for Strained and
 * Weak, red for Critical. Stable, Strong and Exceptional stay neutral.
 */
export function statusTextClass(status: string): string {
  if (status === "Critical") return "text-error";
  if (status === "Weak" || status === "Strained") return "text-warning";
  return "text-foreground";
}

/** Below this, democratic health reads as a failed state (see democraticHealthLabel). */
const FAILED_STATE_BELOW = 20;

/**
 * Democratic health colour. Neutral while no penalty applies; amber once the
 * score is in the penalty range (below the fallout threshold of 60); red at
 * failed-state level.
 */
export function healthTone(value: number): { text: string; marker: string } {
  if (value < FAILED_STATE_BELOW) return { text: "text-error", marker: "bg-error" };
  if (value < DEMOCRATIC_HEALTH_FALLOUT_THRESHOLD) {
    return { text: "text-warning", marker: "bg-warning" };
  }
  return { text: "text-foreground", marker: "bg-foreground" };
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

/** Political-association tone: blue (left), muted (mixed), red (right). */
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
