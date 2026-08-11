/**
 * Service Level Objectives (SLOs) for A House Divided.
 *
 * These are the reliability targets we hold ourselves to. Events are tagged
 * with `slo.*` booleans (see withApiMetrics and turnHealth) so GlitchTip can be
 * queried for the error budget: the fraction of `slo.api_availability:false`
 * events over a window is the burn against the 99.5% availability target.
 *
 * Keep these as plain constants — they document intent and give tagging code a
 * single source of truth for thresholds.
 */

export const SLO = {
  /** Fraction of API requests that must return < 500. */
  API_AVAILABILITY: 0.995,
  /** Fraction of turns that must complete without failing a phase. */
  TURN_SUCCESS: 0.99,
  /** Fraction of API requests whose latency must stay under the budget below. */
  API_LATENCY: 0.95,
  /** Latency budget (ms) an API request must beat to count as "fast". */
  API_LATENCY_BUDGET_MS: 1000,
} as const;

/** Sentry tag keys for SLO signals, so tagging code and dashboards agree. */
export const SLO_TAG = {
  API_AVAILABILITY: "slo.api_availability",
  TURN_SUCCESS: "slo.turn_success",
} as const;
