/**
 * Ceiling fraction of a suspended campaign's support (campaign strength + per
 * state ground org) that transfers to the endorsed ticket. This is the identity
 * magnitude the presidential ruleset's `suspendTransferMaxFraction` defaults to,
 * so the engine and the suspend-endorse command both resolve the live fraction
 * off one number. A perfectly aligned suspender transfers this whole ceiling;
 * under affinity mode a misaligned one transfers proportionally less.
 */
export const SUSPEND_ENDORSE_TRANSFER_MAX_FRACTION = 0.25;
