/**
 * Where a new account came from, kept first-party and coarse.
 *
 * On a logged-out visitor's first page view that arrives from another site or
 * carries `utm_*` tags, the proxy stores a short first-party cookie with the
 * referring site's domain and the campaign tags. Account creation copies it to
 * `users.acquisition` and onto the anonymous `account_registered` count. No
 * full URL, path, query or third-party identifier is kept, matching the
 * PostHog client, which already strips referrers.
 *
 * This module is imported by the Edge proxy, so it must stay free of Node-only
 * imports.
 */

export const ACQUISITION_COOKIE = "__ahd_src";
/** Thirty days covers "saw it on Reddit, signed up at the weekend". */
export const ACQUISITION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface Acquisition {
  /** Registrable-ish domain of the external referrer, e.g. "reddit.com", or "direct". */
  referrerDomain: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  /** Coarse first page: "home", "wiki", "register" or "other". */
  landing: string;
  /** Unix seconds of the first tagged visit. */
  firstSeenAt: number;
}

const OWN_HOSTS = /(^|\.)ahousedividedgame\.com$|(^|\.)railway\.app$|^localhost$|^127\.0\.0\.1$/;
const UTM_VALUE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

/** Lowercase, trim to a safe token, or undefined. */
function utmToken(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase().slice(0, 40);
  return UTM_VALUE.test(v) ? v : undefined;
}

/**
 * Reduce a hostname to its last two labels ("old.reddit.com" -> "reddit.com"),
 * or three for common second-level country domains ("bbc.co.uk").
 */
export function coarseDomain(hostname: string): string | undefined {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]{1,253}$/.test(host) || !host.includes(".")) return undefined;
  const labels = host.split(".").filter(Boolean);
  const secondLevel = labels.length >= 3 && /^(co|com|org|net|ac|gov)$/.test(labels.at(-2)!);
  return labels.slice(secondLevel ? -3 : -2).join(".");
}

function landingArea(pathname: string): string {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/wiki")) return "wiki";
  if (pathname.startsWith("/register")) return "register";
  return "other";
}

/**
 * Build the acquisition record for a first visit, or null when the visit is
 * internal and untagged (nothing worth remembering).
 */
export function acquisitionFromRequest(input: {
  pathname: string;
  searchParams: URLSearchParams;
  referer: string | null;
  now?: number;
}): Acquisition | null {
  const utmSource = utmToken(input.searchParams.get("utm_source"));
  const utmMedium = utmToken(input.searchParams.get("utm_medium"));
  const utmCampaign = utmToken(input.searchParams.get("utm_campaign"));

  let referrerDomain: string | undefined;
  if (input.referer) {
    try {
      const host = new URL(input.referer).hostname;
      if (!OWN_HOSTS.test(host)) referrerDomain = coarseDomain(host);
    } catch {
      // Malformed Referer: treat as absent.
    }
  }
  if (!referrerDomain && !utmSource && !utmMedium && !utmCampaign) return null;

  return {
    referrerDomain: referrerDomain ?? "direct",
    ...(utmSource ? { utmSource } : {}),
    ...(utmMedium ? { utmMedium } : {}),
    ...(utmCampaign ? { utmCampaign } : {}),
    landing: landingArea(input.pathname),
    firstSeenAt: Math.floor((input.now ?? Date.now()) / 1000),
  };
}

const FIELD_ORDER = [
  ["r", "referrerDomain"],
  ["s", "utmSource"],
  ["m", "utmMedium"],
  ["c", "utmCampaign"],
  ["l", "landing"],
  ["t", "firstSeenAt"],
] as const;

export function serializeAcquisition(a: Acquisition): string {
  const params = new URLSearchParams();
  for (const [short, key] of FIELD_ORDER) {
    const value = a[key];
    if (value !== undefined) params.set(short, String(value));
  }
  return params.toString();
}

/** Parse and re-validate the cookie; anything off-shape is discarded. */
export function parseAcquisition(raw: string | undefined | null): Acquisition | null {
  if (!raw || raw.length > 400) return null;
  try {
    const params = new URLSearchParams(raw);
    const referrerDomain = params.get("r");
    const landing = params.get("l");
    const firstSeenAt = Number(params.get("t"));
    if (
      !referrerDomain ||
      !(referrerDomain === "direct" || coarseDomain(referrerDomain) === referrerDomain) ||
      !landing ||
      !/^(home|wiki|register|other)$/.test(landing) ||
      !Number.isInteger(firstSeenAt) ||
      firstSeenAt <= 0
    ) {
      return null;
    }
    const utmSource = utmToken(params.get("s"));
    const utmMedium = utmToken(params.get("m"));
    const utmCampaign = utmToken(params.get("c"));
    return {
      referrerDomain,
      ...(utmSource ? { utmSource } : {}),
      ...(utmMedium ? { utmMedium } : {}),
      ...(utmCampaign ? { utmCampaign } : {}),
      landing,
      firstSeenAt,
    };
  } catch {
    return null;
  }
}

/** Token-safe properties for the anonymous `account_registered` count. */
export function acquisitionEventProperties(a: Acquisition | null): Record<string, string> {
  if (!a) return { referrer_domain: "none" };
  const token = (v: string) => v.replace(/[^a-z0-9]+/g, "_").slice(0, 40);
  return {
    referrer_domain: token(a.referrerDomain),
    landing: a.landing,
    ...(a.utmSource ? { utm_source: token(a.utmSource) } : {}),
    ...(a.utmMedium ? { utm_medium: token(a.utmMedium) } : {}),
    ...(a.utmCampaign ? { utm_campaign: token(a.utmCampaign) } : {}),
  };
}
