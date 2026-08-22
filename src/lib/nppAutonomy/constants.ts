/**
 * Constants for NPP autonomous bill-sponsorship behavior (SP2).
 *
 * Weights must sum to 1.0 for a normalised score, but the model only requires
 * they are positive — adjust freely.
 */

/** Weight applied to the party-platform fit component of the hybrid score. */
export const NPP_SPONSOR_PLATFORM_WEIGHT = 0.5;

/** Weight applied to the conditions-urgency component of the hybrid score. */
export const NPP_SPONSOR_URGENCY_WEIGHT = 0.5;

/**
 * Weight applied to the governing-agenda bias (V1.5): when a formed NPP
 * government has a `governingAgenda`, bills whose domain advances a high-priority
 * agenda item get this much extra score, turning reactive per-NPP sponsorship
 * into agenda-driven government legislation. Zero contribution when no agenda is
 * supplied, so non-governing/v0 sponsorship is unchanged.
 */
export const NPP_SPONSOR_AGENDA_WEIGHT = 0.6;

/**
 * Weight applied to the fiscal-posture bias (V1.6): when the government has a
 * non-neutral fiscal stance, tax/spending bills get this much extra score scaled
 * by the stance's intensity, and the option in the posture's direction is
 * preferred. Zero when no stance is supplied or it is neutral.
 */
export const NPP_SPONSOR_FISCAL_WEIGHT = 0.4;

/**
 * Maximum number of nppSponsored bills that may be simultaneously active
 * (non-terminal) in a single country before sponsorship is throttled off.
 */
export const NPP_SPONSOR_ACTIVE_CAP = 2;

/**
 * Minimum number of game-clock turns that must elapse between the last
 * nppSponsored bill introduction and the next one in the same country.
 */
export const NPP_SPONSOR_COOLDOWN_TURNS = 12;

/**
 * A sponsor party cannot return to the same legislation type inside this
 * window. Four game days is long enough to force several different agenda
 * choices without making a failed policy unavailable for the rest of an era.
 */
export const NPP_SPONSOR_TYPE_REPEAT_COOLDOWN_TURNS = 96;

/**
 * Voting window (in turns/hours) for an nppSponsored bill. Shared by the proposer
 * (sets votingEndsOnTurn = currentTurn + this) and the cooldown derivation
 * (recovers proposalTurn = votingEndsOnTurn - this), so the two can never drift.
 */
export const NPP_BILL_VOTING_DURATION_HOURS = 24;
