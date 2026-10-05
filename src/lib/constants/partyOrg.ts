/**
 * Party organization tunable constants (election cycles, decay).
 *
 * Lives under `src/lib/constants/` so UI, API routes, seeds, and turn logic share
 * one source of truth without importing from `src/lib/turn/` (see
 * `docs/engineering/architecture-boundaries.md`).
 */

/** Election cycle lengths in turns */
export const CYCLE_TURNS = {
  // US election types
  governor: 192,
  senate: 288,
  house: 96,
  stateSenate: 192,
  // UK election types (commons = 5 year term = 240 turns; regionalCouncil syncs with commons)
  commons: 240,
  regionalCouncil: 240,
  // JP election types (shugiin = 4 year term = 192; sangiin = 6 year term per class = 288)
  shugiin: 192,
  sangiin: 288,
  // DE election types (bundestag = 4 year term = 192; landtag = 5 year term = 240;
  // ministerPresident shares the landtag cycle — MP elections spawn paired
  // with each Land's Landtag election so timing matches RL practice where
  // the new majority appoints the MP after each state-parliament election)
  bundestag: 192,
  landtag: 240,
  ministerPresident: 240,
} as const;

// ─── Organization Building ────────────────────────────────────────────────────

/** Dollars required to gain +1 org per turn from org building */
export const DOLLARS_PER_ORG = 75000;

/**
 * Organization bucket tuning.
 *
 * A successful Build Org action always deposits one unit. A region begins with
 * a permanent 100-unit Unaffiliated stake which is always included in the
 * denominator and never decays. Org shares are each party's fraction of that
 * stake plus all party contributions.
 */
export const ORG_BUCKET_BASELINE_UNITS = 100;
export const ORG_BUILD_UNITS_PER_CLICK = 1;

/**
 * Legacy percentages need enough starting units to coexist with the permanent
 * Unaffiliated stake without a severe one-time visible drop. Conversion chooses
 * the exact regional scale when possible and caps it here near saturation so a
 * historical 100% region still leaves room for the permanent stake.
 */
export const ORG_LEGACY_UNITS_PER_PERCENT_MAX = 10;

/**
 * A party gets 96 turns without investment before its accumulated units begin
 * to decay. At the standard hourly cadence, this is four real-time days. Any
 * successful Build Org action resets this clock for that party in that region.
 */
export const ORG_DECAY_GRACE_TURNS = 96;

/**
 * Proportional unit decay once the inactivity grace period is reached. At 1%
 * per turn, an inactive balance loses about 21.4% per real-time day and has a
 * half-life of roughly 69 turns, or 2.9 days, after decay starts. Decaying
 * units, instead of percentage points, preserves the bucket's accumulated-
 * investment semantics.
 */
export const ORG_UNIT_DECAY_RATE = 0.01;

// ─── Default Tax Rates ─────────────────────────────────────────────────────────

/**
 * Default state party tax rate (%) when no players are in the state/party.
 * Allows NPPs to still contribute to party treasury even in unoccupied regions.
 */
export const DEFAULT_NPP_STATE_TAX_RATE = 5;

// —— Caucus NPP Recruitment ———————————————————————————————————————————————————————————————

/** Minimum chair↔NPP relationship required to recruit an NPP into a caucus. */
export const CAUCUS_NPP_RECRUIT_MIN_RELATIONSHIP = 60;

/**
 * Cooldown between successful caucus NPP recruitments. Resolved turn-first
 * (`CAUCUS_NPP_RECRUIT_COOLDOWN_TURNS`) so it freezes on pause; the `_MS` value
 * is the wall-clock fallback for memberships that pre-date `joinedAtTurn`.
 */
export const CAUCUS_NPP_RECRUIT_COOLDOWN_TURNS = 12; // 12 turns = 12h at standard cadence
export const CAUCUS_NPP_RECRUIT_COOLDOWN_MS = 12 * 60 * 60 * 1000;

/**
 * Relationship floor to remain in a caucus after the per-turn upkeep pass.
 * It is intentionally far lower than the recruit threshold so caucus
 * membership is meaningfully harder to earn than it is to maintain.
 */
export const CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP = 20;

/**
 * NPP relationships drift back toward neutral over time so one-off meetings do
 * not permanently lock in access to Slate, caucus recruitment, and influence.
 */
export const NPP_RELATIONSHIP_DECAY_PER_TURN = 0.1;
