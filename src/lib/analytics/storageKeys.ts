/**
 * Storage keys for analytics funnel anchors.
 *
 * Shared so that the PostHog transport layer can clear pending milestones on
 * consent withdrawal while the funnel logic lives in `./capture`.
 */

/** Analytics consent choice. Owned by CookieConsent. */
export const COOKIE_CONSENT_KEY = "ahd-cookie-consent";
export const FIRST_TURN_KEY = "ahd-posthog-first-turn";
export const FIRST_MEANINGFUL_ACTION_KEY = "ahd-posthog-first-meaningful-action";
export const ACCOUNT_CREATED_KEY = "ahd-posthog-account-created";
