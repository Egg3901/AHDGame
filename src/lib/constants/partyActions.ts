/**
 * Constants for chair-initiated party actions (purge, etc.).
 * Shared between API routes and client components.
 */

/**
 * Master switch for the chair-initiated member purge mechanic.
 * Disabled for now: chairs cannot expel members while this is false. The route
 * rejects requests and the Chair Office UI hides the purge controls. Flip back
 * to `true` to re-enable without any further code changes.
 */
export const PARTY_PURGE_ENABLED = false;

/** Turns a party must wait between member purges */
export const PURGE_COOLDOWN_TURNS = 48;

/** Base infamy added to the chair when a purge is executed */
export const PURGE_CHAIR_INFAMY_COST_BASE = 25;

/** Infamy escalation per successive purge (multiplicative, +50%) */
export const PURGE_CHAIR_INFAMY_ESCALATION = 1.5;

/** Turns a purged member must wait before rejoining the party that purged them */
export const PURGE_REJOIN_COOLDOWN_TURNS = 24;

/** Maximum cap on chair infamy from a single purge */
export const PURGE_CHAIR_INFAMY_MAX = 100;
