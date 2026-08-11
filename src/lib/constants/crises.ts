// src/lib/constants/crises.ts
/** Slider cap: max aid pledge as a fraction of the sender's GDP. */
export const AID_MAX_PCT_GDP = 0.02;
/** Slider default pledge as a fraction of the sender's GDP. */
export const AID_DEFAULT_PCT_GDP = 0.005;
/** Max sender approval bump (percentage points) at a full-cap pledge. */
export const AID_SENDER_APPROVAL_CAP = 2;
/** Approval penalty (percentage points) applied to a sender whose aid bill fails. */
export const AID_FAILED_PENALTY = 5;
/** Turns the failed-vote approval penalty lasts before the sweep reverses it. */
export const AID_PENALTY_TURNS = 6;
