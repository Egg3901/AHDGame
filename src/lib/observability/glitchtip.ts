/**
 * GlitchTip deep-link helpers.
 *
 * Builds a URL to a specific event in the GlitchTip (self-hosted Sentry)
 * dashboard, so admins can jump directly from a player's bug report to the
 * captured stack trace.
 *
 * The GlitchTip base URL is configured via the `GLITCHTIP_URL` env var
 * (e.g. your Sentry-compatible host). If unset, the link
 * builder returns null and the UI hides the deep link.
 */

/** Base URL of the GlitchTip instance, without trailing slash. */
export function getGlitchTipBaseUrl(): string | null {
  const url = process.env.GLITCHTIP_URL ?? process.env.NEXT_PUBLIC_GLITCHTIP_URL;
  if (!url) return null;
  return url.replace(/\/+$/, "");
}

/**
 * Build a deep link to a specific GlitchTip event.
 *
 * @param eventId - The Sentry/GlitchTip event UUID (from `captureException`'s return or `lastEventId`).
 * @param orgSlug - GlitchTip organization slug. Defaults to "ahd".
 * @returns Full URL or null if GlitchTip base URL is not configured.
 */
export function glitchtipEventUrl(eventId: string, orgSlug = "ahd"): string | null {
  const base = getGlitchTipBaseUrl();
  if (!base) return null;
  return `${base}/organizations/${orgSlug}/issues/?query=${eventId}`;
}

/**
 * Build a deep link to the GlitchTip issues list for a specific project.
 *
 * @param orgSlug    - GlitchTip organization slug.
 * @param projectSlug - GlitchTip project slug.
 */
export function glitchtipIssuesUrl(orgSlug = "ahd", projectSlug = "ahd"): string | null {
  const base = getGlitchTipBaseUrl();
  if (!base) return null;
  return `${base}/organizations/${orgSlug}/issues/?project=${projectSlug}`;
}
