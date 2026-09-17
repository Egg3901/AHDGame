/**
 * Client-safe ministerial action copy.
 *
 * This module has no server-only imports precisely so client components can
 * share the reset hint with the API/turn copy rather than keep a second copy
 * that drifts. Keep it that way: no database, clock, `mongodb`, or `@/app`
 * imports here. Server logic lives in `./ministerialActionPool`.
 */
export const MINISTERIAL_ACTION_RESET_HINT = "Resets daily at midnight Eastern Time.";
