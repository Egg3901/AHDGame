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
/**
 * Per-network, per-turn upkeep, as a fraction of the OWNER'S GDP. Preserves the ratios the
 * old flat constants carried (0.53 / 1.47 / 3.47 of a collection operation); only the
 * denomination is fixed. See OP_COST_GDP_FRACTION below for why flat prices could not work.
 */
export const NETWORK_UPKEEP_GDP_FRACTION = {
  none: 0,
  trickle: 4.8e-6,
  steady: 1.32e-5,
  crash: 3.12e-5,
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
/**
 * Operation cost as a fraction of the OWNER'S OWN GDP, not a flat currency amount.
 *
 * `federalBudget.gdp` is denominated in each country's own currency — live figures span
 * RU 1.478e12 down to UK 2.201e10 — so a flat price is not a balance dial, it is a currency
 * artefact: 75,000 bought the UK three operations a turn and Russia two hundred at the very
 * same share of GDP. Because the funding line is also a fraction of the same GDP, GDP
 * CANCELS, and a given funding level affords exactly the same in every country and era.
 *
 * Calibrated so level 2 ("Standing Service", 0.0015 of GDP) affords both operation slots
 * plus one network at `steady`, which is the design centre of the funding ladder.
 */
export const OP_COST_GDP_FRACTION = 9.0e-6;
export const ACTION_COST_GDP_FRACTION = 2.7e-5;
/** Baseline difficulty, 0..100, before network, coverage and tradecraft. */
export const COLLECTION_DIFFICULTY = 20;
export const ACTION_DIFFICULTY = 45;

// ── Agency ──────────────────────────────────────────────────────────────────
export const TRADECRAFT_MIN = 1;
export const TRADECRAFT_MAX = 10;
export const TRADECRAFT_DEFAULT = 3;
export const COUNTER_INTEL_MAX = 100;
export const COUNTER_INTEL_DEFAULT = 20;

// ── Strategic assessment (phase 2) ──────────────────────────────────────────
/** Widest deviation a fogged intelligence figure can carry. */
export const INTEL_FOG_MAX_DEVIATION = 0.2;
/** Turns a fogged reading stays stable for. Stops refresh-until-it-averages. */
export const INTEL_FOG_WINDOW_TURNS = 6;

/** Live coverage each assessment tier needs. */
export const ASSESS_EXISTENCE_COVERAGE = 25;
export const ASSESS_ESTIMATE_COVERAGE = 55;
export const ASSESS_EXACT_COVERAGE = 80;

/** Tension a strategic operation adds when it is ATTRIBUTED. Under a test's. */
export const STRATEGIC_ATTRIBUTION_TENSION = 6;

// ── Military sabotage (phase 3) ─────────────────────────────────────────────
//
// PROVISIONAL, and unlike the rest of this file these three are a BALANCE
// CHANGE: they move real battle outcomes. They are set by the simulation report
// at scripts/sim/reports/, not by judgement, and must not be tuned without
// re-running it.

/** Points taken off a front's SEEDED supply base. Never the derived reading. */
export const SABOTAGE_SUPPLY_POINTS = 8;
/** Points taken off each formation's readiness. */
export const SABOTAGE_READINESS_POINTS = 10;
/** Formations one operation can reach. Its readiest, which is where it hurts. */
export const SABOTAGE_UNIT_COUNT = 5;

// ── Economic operations (phase 4) ───────────────────────────────────────────
/**
 * Turns a leaked corporation's books stay public.
 *
 * A duration, not a magnitude: the leak changes WHO CAN SEE the real figures and
 * moves no number itself, so it carries no balance-report gate the way a
 * production or supply magnitude would. The market reacting to what it can now
 * read is the point.
 */
export const BOOKS_EXPOSED_TURNS = 24;
