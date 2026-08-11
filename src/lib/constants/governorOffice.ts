/**
 * Constants for the Governor's Office / Minister-President's Office feature.
 * Values are tunable post-v1; collect them here for one-touch balance.
 */

// Office AP pool — analogous to ministerialActions on cabinet members.
export const GUBERNATORIAL_ACTION_CAP = 3;
export const GUBERNATORIAL_ACTION_REGEN_INTERVAL = 18;

// Executive orders
export const EXEC_ORDER_DURATION_TURNS = 24;
export const EXEC_ORDER_SLOT_CAP = 2;
/** AP cost per step shifted (orders can shift by 1 or 2 steps). */
export const EXEC_ORDER_AP_COST_PER_STEP = 1;
/** Maximum number of policy steps an order can shift in a single issuance. */
export const EXEC_ORDER_MAX_STEPS = 2;
/** @deprecated Use EXEC_ORDER_AP_COST_PER_STEP — kept temporarily for callers reading the old name. */
export const EXEC_ORDER_AP_COST = EXEC_ORDER_AP_COST_PER_STEP;

// State of the State address
export const ADDRESS_COOLDOWN_TURNS = 8;
export const ADDRESS_APPROVAL_BUMP = 3;
export const ADDRESS_APPROVAL_DURATION_TURNS = 24;
/** Magnitude of the demographic turnout boost applied at delivery (±20 cap). */
export const ADDRESS_DEMOGRAPHIC_DELTA = 5;
/** Additive per-group favorability bump applied to the leader's party when an
 *  address targets a demographic group. Read in the election vote-distribution
 *  engine as a `(1 + delta/100)` multiplier on that party's group-level weight. */
export const ADDRESS_PARTY_GROUP_FAVORABILITY_DELTA = 5;
/** How long agenda + demographic effects last. Approval bump expires sooner. */
export const ADDRESS_AGENDA_DURATION_TURNS = 24;
export const ADDRESS_DEMOGRAPHIC_DURATION_TURNS = 24;
/** Additive cross-pressure force a co-partisan NPP picks up on bills in an
 *  emphasized category. Forces sum to >+5 → vote FOR, <-5 → AGAINST. */
export const ADDRESS_AGENDA_FORCE_BIAS = 8;
export const ADDRESS_ACTION_COST = 1;
export const ADDRESS_NPI_COST = 5;
export const ADDRESS_EMPHASIS_MIN = 1;
export const ADDRESS_EMPHASIS_MAX = 2;
/** Player-written title + body bounds for the LARP-friendly address content. */
export const ADDRESS_TITLE_MIN_LENGTH = 10;
export const ADDRESS_TITLE_MAX_LENGTH = 200;
export const ADDRESS_BODY_MAX_LENGTH = 2000;

// Endorsements
export const GOVERNOR_ENDORSEMENT_CAMPAIGN_ACTIONS = 1.5;
export const GOVERNOR_ENDORSEMENT_ACTION_COST = 1;

// Veto message bounds
export const VETO_MESSAGE_MIN_LENGTH = 10;
export const VETO_MESSAGE_MAX_LENGTH = 280;
