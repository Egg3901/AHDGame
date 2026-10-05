// Pure ownership constants, free of server imports so client cards can reach them.

/** Another corporation must hold above this % of outstanding shares for subsidiary status. */
export const SUBSIDIARY_OWNERSHIP_THRESHOLD_PERCENT = 50;

/** Required corporate ownership % to unlock hostile takeover merge. */
export const HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT = 75;

/**
 * Premium over market (25% → pay 125% of share price per minority share).
 * Matches hostile takeover squeeze-out payout.
 */
export const HOSTILE_TAKEOVER_PREMIUM_RATE = 0.25;
