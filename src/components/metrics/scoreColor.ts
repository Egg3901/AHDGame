/**
 * Score (0–100) → hex color for health rings and chart strokes.
 *
 * Isolated raw hex (permitted for charts/SVG per the design system). Tier
 * boundaries mirror `getMetricBadge` in `@/lib/utils/metricScoring` so a ring's
 * color and a card's badge label always agree.
 */
export function scoreColor(score: number): string {
  const s = Math.max(0, Math.min(100, score));
  if (s >= 90) return "#2dd4bf"; // teal — Excellent
  if (s >= 75) return "#22c55e"; // green — Very Good
  if (s >= 55) return "#4ade80"; // emerald — Good
  if (s >= 40) return "#eab308"; // yellow — Fair
  if (s >= 20) return "#f59e0b"; // orange — Bad
  return "#ef4444"; // red — Very Bad
}
