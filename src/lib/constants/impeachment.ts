/** Turn-based windows and cooldown for presidential impeachment (two-chamber). */

/** Turns the House has to vote on articles before they lapse to a decision. */
export const IMPEACHMENT_HOUSE_VOTING_TURNS = 6;

/** Turns the Senate has to vote on conviction once the House impeaches. */
export const IMPEACHMENT_SENATE_VOTING_TURNS = 6;

/**
 * Turns before another impeachment can be filed against the same target after a
 * prior attempt was filed. Mirrors NO_CONFIDENCE_COOLDOWN_TURNS so re-filing
 * cannot be used to grief a sitting executive.
 */
export const IMPEACHMENT_COOLDOWN_TURNS = 48;
