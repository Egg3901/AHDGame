/**
 * Pure ruling-party confidence surface — constants, threshold bands, and
 * clamp/bump helpers shared by the turn engine and the UI. The persistence
 * side (install/renew/adjust against countryLeaderStates) lives in
 * `@/lib/turn/rulingPartyConfidence`, which re-exports everything here.
 */

// ── Constants ──────────────────────────────────────────────────────────────

/** Confidence value for a newly installed leader. */
export const INITIAL_CONFIDENCE = 75;

/** Confidence bump on leadership renewal (re-election, confirmation). */
export const RENEWAL_BUMP = 5;

/**
 * Confidence bump the carried head of government takes when their state
 * absorbs another — the reunification dividend.
 *
 * Larger than `RENEWAL_BUMP` on purpose: a renewal is the party confirming the
 * leader it already had, while this is the leader delivering the territorial
 * settlement the regime exists to pursue. Still well short of the 20 points
 * between confidence bands, so it strengthens a leader without promoting one
 * out of a crisis in a single step.
 *
 * BALANCE CONSTANT.
 */
export const REUNIFICATION_BUMP = 10;

/** Maximum confidence cap. */
export const MAX_CONFIDENCE = 95;

/** Minimum confidence floor. */
export const MIN_CONFIDENCE = 0;

/** Maximum history entries to keep per leader. */
export const MAX_HISTORY_ENTRIES = 50;

// ── Threshold bands ────────────────────────────────────────────────────────

export const CONFIDENCE_BANDS = [
  { min: 80, label: "secure", description: "Secure leadership" },
  { min: 65, label: "stable", description: "Stable leadership" },
  { min: 50, label: "watchful", description: "Watchful party" },
  { min: 35, label: "strained", description: "Strained leadership" },
  { min: 20, label: "crisis", description: "Crisis risk" },
  { min: 0, label: "critical", description: "Leadership challenge or forced transition risk" },
] as const;

export type ConfidenceBandLabel = (typeof CONFIDENCE_BANDS)[number]["label"];

/**
 * Classify a confidence value into its band.
 * Returns the highest band whose min threshold is met.
 */
export function classifyConfidenceBand(value: number): ConfidenceBandLabel {
  for (const band of CONFIDENCE_BANDS) {
    if (value >= band.min) return band.label;
  }
  return "critical";
}

/** Clamp a value to the valid confidence range. */
export function clampConfidence(value: number): number {
  return Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, value));
}

/**
 * Initialize confidence for a new leader.
 * Returns INITIAL_CONFIDENCE (75) regardless of previous leader.
 */
export function initializeLeaderConfidence(): number {
  return INITIAL_CONFIDENCE;
}

/**
 * Apply renewal bump to existing confidence.
 * Adds RENEWAL_BUMP (+5), capped at MAX_CONFIDENCE (95).
 */
export function applyLeadershipRenewalBump(current: number): number {
  return clampConfidence(current + RENEWAL_BUMP);
}
