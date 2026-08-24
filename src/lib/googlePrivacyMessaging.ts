import { isAdSenseContentPath } from "@/lib/adsenseContent";

const GOOGLE_CMP_POLICY_PAGE_PATHS = ["/privacy"] as const;
const FALLBACK_COOKIE_CONSENT_KEY = "ahd-cookie-consent";
const GOOGLE_CMP_SITE_HOSTS = new Set(["ahousedividedgame.com", "www.ahousedividedgame.com"]);

export const GOOGLE_CONSENT_MODE_REGION_CODES = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IS",
  "IE",
  "IT",
  "LV",
  "LI",
  "LT",
  "LU",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "GB",
  "CH",
] as const;

export function getAdSenseClientId(): string | null {
  const raw = process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim();
  if (!raw) return null;
  return raw;
}

export function getAdSensePageTagUrl(clientId: string): string {
  return `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`;
}

export function isGoogleCmpSiteHost(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  const normalized = hostname.toLowerCase().split(":")[0];
  return GOOGLE_CMP_SITE_HOSTS.has(normalized);
}

export function isGoogleCmpConfigured(hostname?: string | null): boolean {
  return getAdSenseClientId() !== null && (hostname == null || isGoogleCmpSiteHost(hostname));
}

export function isPrivacyMessagingExcludedPath(pathname: string): boolean {
  return GOOGLE_CMP_POLICY_PAGE_PATHS.some((path) => pathname === path);
}

export function shouldRenderGooglePrivacyMessaging(
  pathname: string,
  hostname?: string | null
): boolean {
  return (
    isGoogleCmpConfigured(hostname) &&
    isAdSenseContentPath(pathname) &&
    !isPrivacyMessagingExcludedPath(pathname)
  );
}

export function shouldRenderConsentManagedGoogleTags(pathname: string): boolean {
  return !isPrivacyMessagingExcludedPath(pathname);
}

export type GoogleTagConsentMode = "cmp" | "fallback" | "none";

export function buildGoogleTagBootstrapScript(
  measurementId: string,
  consentMode: GoogleTagConsentMode
): string {
  const lines = [
    "window.dataLayer = window.dataLayer || [];",
    "function gtag(){dataLayer.push(arguments);}",
    "window.gtag = window.gtag || gtag;",
  ];

  if (consentMode === "cmp") {
    lines.push(
      `gtag('consent', 'default', ${JSON.stringify({
        ad_storage: "denied",
        analytics_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        region: [...GOOGLE_CONSENT_MODE_REGION_CODES],
        wait_for_update: 500,
      })});`,
      `gtag('consent', 'default', ${JSON.stringify({
        ad_storage: "granted",
        analytics_storage: "granted",
        ad_user_data: "granted",
        ad_personalization: "granted",
      })});`
    );
  } else if (consentMode === "fallback") {
    lines.push(
      `
        (function() {
          var storedConsent = null;
          try {
            storedConsent = window.localStorage.getItem(${JSON.stringify(FALLBACK_COOKIE_CONSENT_KEY)});
          } catch {}

          if (storedConsent === "accepted") {
            gtag('consent', 'default', ${JSON.stringify({
              ad_storage: "granted",
              analytics_storage: "granted",
              ad_user_data: "granted",
              ad_personalization: "granted",
            })});
            return;
          }

          gtag('consent', 'default', ${JSON.stringify({
            ad_storage: "denied",
            analytics_storage: "denied",
            ad_user_data: "denied",
            ad_personalization: "denied",
            wait_for_update: 500,
          })});
        })();
      `.trim()
    );
  }

  lines.push(`gtag('js', new Date());`, `gtag('config', ${JSON.stringify(measurementId)});`);

  return lines.join("\n");
}
