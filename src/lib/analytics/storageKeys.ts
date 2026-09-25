/**
 * Storage keys for analytics funnel anchors.
 *
 * Shared so that the PostHog transport layer can clear pending milestones on
 * consent withdrawal while the funnel logic lives in `./capture`.
 */
export const FIRST_TURN_KEY = "ahd-posthog-first-turn";
export const ACCOUNT_CREATED_KEY = "ahd-posthog-account-created";
