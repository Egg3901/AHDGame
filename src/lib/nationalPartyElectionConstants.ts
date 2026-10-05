// Duration constants kept in a leaf module so caucus chair elections can read them
// without importing the national election engine.

export const NATIONAL_ELECTION_DURATION_TURNS = 72;
export const NATIONAL_ELECTION_MIN_DURATION_TURNS = 168;
export const NATIONAL_ELECTION_MAX_DURATION_TURNS = 420;
/**
 * Duration of the accelerated leadership elections each party runs while the
 * live pre-iteration founding phase is active. 12 turns ≈ 12 hours. Founding
 * elections are marked `founding: true` and waive the 24h new-character
 * cooldown and the party-tenure gate, so brand-new players can seat the full
 * leadership slate (chair / vice-chair / treasurer) at iteration start.
 */
export const FOUNDING_CHAIR_ELECTION_DURATION_TURNS = 12;
