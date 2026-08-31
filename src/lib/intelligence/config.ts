/**
 * Every tunable the intelligence system has, in one place.
 *
 * PROVISIONAL. Phase 1 ships no world-state effects, so these values only shape
 * the feel of the loop, not game balance. They are tuned for real by the phase 3
 * (military) and phase 4 (economic) simulation reports, which is when the system
 * first touches balance. Do not scatter magic numbers outside this file.
 */

// ── Coverage ────────────────────────────────────────────────────────────────
export const COVERAGE_MAX = 100;
/** Points of coverage lost per turn since collection. Intelligence goes stale. */
export const COVERAGE_DECAY_PER_TURN = 2;
/** Coverage a successful collection operation adds. */
export const COLLECTION_GAIN = 25;

// ── Networks ────────────────────────────────────────────────────────────────
export const NETWORK_MAX_LEVEL = 5;
/** Progress needed to gain one level. */
export const NETWORK_LEVEL_PROGRESS = 100;
/** Progress added per turn by funding level. Mirrors covertNuclear's shape. */
export const NETWORK_FUNDING_PROGRESS = {
  none: 0,
  trickle: 4,
  steady: 9,
  crash: 18,
} as const;
/** Cost per turn by funding level, drawn from the intelligence budget. */
export const NETWORK_FUNDING_COST = {
  none: 0,
  trickle: 40_000,
  steady: 110_000,
  crash: 260_000,
} as const;
/** Turns a burned network stays unusable. */
export const NETWORK_BURN_COOLDOWN_TURNS = 12;

// ── Suspicion ───────────────────────────────────────────────────────────────
export const SUSPICION_MAX = 100;
/** Added by running any operation against a target. */
export const SUSPICION_PER_OP = 8;
/** Shed per turn on a network that ran no operation. Pace against exposure. */
export const SUSPICION_DECAY_IDLE = 4;
/** Suspicion a network is left holding after being burned. */
export const SUSPICION_AFTER_BURN = 30;

// ── Operations ──────────────────────────────────────────────────────────────
export const OP_SLOTS_PER_TURN = 2;
export const COLLECTION_MIN_NETWORK_LEVEL = 1;
export const ACTION_MIN_NETWORK_LEVEL = 2;
/** Live coverage an action operation needs. The "cannot act blind" gate. */
export const ACTION_MIN_COVERAGE = 40;
export const COLLECTION_COST = 75_000;
export const ACTION_COST = 220_000;

// ── Agency ──────────────────────────────────────────────────────────────────
export const TRADECRAFT_MIN = 1;
export const TRADECRAFT_MAX = 10;
export const TRADECRAFT_DEFAULT = 3;
export const COUNTER_INTEL_MAX = 100;
export const COUNTER_INTEL_DEFAULT = 20;
