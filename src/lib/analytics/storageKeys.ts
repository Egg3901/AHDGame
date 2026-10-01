/**
 * Storage keys for analytics funnel anchors.
 *
 * Shared so that the PostHog transport layer can clear pending milestones on
 * consent withdrawal while the funnel logic lives in `./capture`.
 */

/** Analytics consent choice. Owned by CookieConsent; read raw by pre-hydration scripts. */
export const COOKIE_CONSENT_KEY = "ahd-cookie-consent";
export const FIRST_TURN_KEY = "ahd-posthog-first-turn";
export const ACCOUNT_CREATED_KEY = "ahd-posthog-account-created";
/** Last PostHog assignment for the profile redesign, read before hydration to avoid a flash. */
export const PROFILE_DESIGN_KEY = "ahd-posthog-profile-design";
export const PROFILE_DESIGN_PENDING_ATTR = "data-profile-design-pending";

/**
 * Runs before the profile paints. A returning dossier player hides the page
 * until hydration applies the cached assignment, so they never see control
 * first. The timeout guarantees the page shows even if hydration stalls.
 */
export const PROFILE_DESIGN_PRELOAD_SCRIPT = `try{if(localStorage.getItem("${COOKIE_CONSENT_KEY}")==="accepted"&&localStorage.getItem("${PROFILE_DESIGN_KEY}")==="dossier"){var d=document.documentElement;d.setAttribute("${PROFILE_DESIGN_PENDING_ATTR}","");setTimeout(function(){d.removeAttribute("${PROFILE_DESIGN_PENDING_ATTR}")},1500)}}catch(e){}`;
