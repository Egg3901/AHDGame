/** Humanize a camelCase metric id into a display label (e.g. "voterTurnout" → "Voter Turnout").
 * Extracted from billEnrichment so server modules can share it without an import cycle. */
export function effectTargetLabelFromMetricId(metricId: string): string {
  return metricId
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}
