/**
 * Server-side Cloudflare edge fingerprint (forensics-v2 Part A).
 *
 * The app is fronted by Cloudflare (`src/lib/utils/network.ts`'s
 * `getClientIp()` already trusts `cf-connecting-ip` for exactly this
 * reason). Beyond the connecting IP, Cloudflare can surface a handful of
 * edge-computed signals as request headers — visitor country, colo/ASN, and
 * (Bot Management plans only) a JA3/JA4 TLS fingerprint plus bot/threat
 * scores. None of these are guaranteed: header availability depends on the
 * zone's Cloudflare plan and whatever Transform Rules/Managed Transforms an
 * operator has wired up, and local dev never sits behind Cloudflare at all.
 *
 * `getCfFingerprint()` is therefore a PURE, fully defensive reader: every
 * field is optional, unknown/malformed values are dropped rather than
 * stored, and a request with zero Cloudflare headers (local dev, direct
 * origin access) simply yields `{}`. Callers store whatever comes back —
 * never block or degrade behavior on an absent field.
 *
 * The high-value field is `ja4` (JA4, falling back to JA3 if that's the only
 * one the zone exposes): a TLS ClientHello fingerprint that identifies the
 * client's TLS stack (browser + OS + TLS library build), independent of
 * cookies, localStorage, or canvas/WebGL rendering. It survives cookie
 * clears and incognito mode, which is exactly what makes it valuable as a
 * corroborating alt-detection signal (`cf_tls_fingerprint`,
 * `src/lib/altDetection/signals.ts`) — but it is COARSER than an exact
 * device fingerprint: many unrelated users on the same browser/OS build
 * share an identical JA4, so it is weighted as "strong", not "definitive"
 * (see that signal's weight/description).
 */

/** Minimal header-reader shape both `Request.headers` (a real `Headers`
 * instance) and `next/headers`'s `ReadonlyHeaders` satisfy. */
export interface HeaderGetter {
  get(name: string): string | null;
}

/** Structured Cloudflare edge fingerprint. Every field is optional — absent
 * means "this zone/request didn't expose it," never an error. */
export interface CfFingerprint {
  /** ISO 3166-1 alpha-2 country of the connecting IP (`cf-ipcountry`).
   * Cloudflare's own "unknown" (`XX`) and Tor-exit (`T1`) sentinels are
   * dropped rather than stored as a country. */
  country?: string;
  /** ASN/org string for the connecting IP, when a Transform Rule exposes it
   * (`cf-asn`/`x-cf-asn`; not sent by Cloudflare out of the box — this is an
   * operator-configured header, hence the fallback name). */
  asn?: string;
  /** Cloudflare data-center code the request was served from
   * (`cf-colo`/`x-cf-colo`, or parsed from the `-COLO` suffix of `cf-ray`
   * when no explicit colo header exists). */
  colo?: string;
  /** JA4 TLS ClientHello fingerprint (Cloudflare Bot Management), falling
   * back to JA3 if only that's exposed. Same field either way — the alt
   * signal treats them as equivalent "TLS stack fingerprint" evidence. */
  ja4?: string;
  /** Cloudflare Bot Management score, 1 (very likely bot) to 99 (very
   * likely human). Only present on Bot Management-enabled zones. */
  botScore?: number;
  /** Cloudflare threat score, 0 (no threat) to 100 (high threat). */
  threatScore?: number;
}

// Header name candidates, most-specific/standard first. JA4/JA3, ASN, colo,
// and the score headers are NOT stock Cloudflare response-to-origin headers
// on most plans — they require Bot Management (JA4/scores) or an explicit
// Transform Rule (ASN/colo) forwarding the corresponding `cf.*` dynamic
// field as a header. Multiple candidate names are checked because the exact
// header an operator lands on varies; this list is the single place to add
// a new alias if the zone's naming changes.
const ASN_HEADERS = ["cf-asn", "x-cf-asn"];
const COLO_HEADERS = ["cf-colo", "x-cf-colo"];
const JA4_HEADERS = ["cf-ja4", "x-ja4", "cf-bot-management-ja4"];
const JA3_HEADERS = ["cf-ja3-hash", "x-ja3-hash", "cf-bot-management-ja3-hash"];
const BOT_SCORE_HEADERS = ["cf-bot-score", "x-cf-bot-score"];
const THREAT_SCORE_HEADERS = ["cf-threat-score", "x-cf-threat-score"];

/** Cloudflare's "unknown country" and Tor-exit sentinel values for
 * `cf-ipcountry` — neither is a real country, so both are dropped. */
const NON_COUNTRY_VALUES = new Set(["XX", "T1"]);

function firstHeader(headers: HeaderGetter, names: string[]): string | undefined {
  for (const name of names) {
    const value = headers.get(name);
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

/** `cf-ray` looks like `7f9a2b3c4d5e6f70-LAX` — the colo is the trailing
 * 3-letter IATA-style airport code after the last hyphen. */
function coloFromRay(ray: string | undefined): string | undefined {
  if (!ray) return undefined;
  const dash = ray.lastIndexOf("-");
  if (dash === -1) return undefined;
  const colo = ray.slice(dash + 1).toUpperCase();
  return /^[A-Z]{3}$/.test(colo) ? colo : undefined;
}

function parseScore(raw: string | undefined, min: number, max: number): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return n;
}

/**
 * Read whatever Cloudflare edge fingerprint fields the current request
 * exposes. Pure and defensive: pass any `Headers`-like object
 * (`request.headers` in a route handler, or the awaited `next/headers`
 * `headers()` store); a request with none of these headers set (no
 * Cloudflare in front, e.g. local dev) returns `{}`.
 */
export function getCfFingerprint(headers: HeaderGetter): CfFingerprint {
  const result: CfFingerprint = {};

  const country = firstHeader(headers, ["cf-ipcountry"]);
  if (country && !NON_COUNTRY_VALUES.has(country.toUpperCase())) {
    result.country = country.toUpperCase();
  }

  const asn = firstHeader(headers, ASN_HEADERS);
  if (asn) result.asn = asn;

  const colo =
    firstHeader(headers, COLO_HEADERS) ?? coloFromRay(headers.get("cf-ray") ?? undefined);
  if (colo) result.colo = colo;

  const ja4 = firstHeader(headers, JA4_HEADERS) ?? firstHeader(headers, JA3_HEADERS);
  if (ja4) result.ja4 = ja4;

  const botScore = parseScore(firstHeader(headers, BOT_SCORE_HEADERS), 1, 99);
  if (botScore !== undefined) result.botScore = botScore;

  const threatScore = parseScore(firstHeader(headers, THREAT_SCORE_HEADERS), 0, 100);
  if (threatScore !== undefined) result.threatScore = threatScore;

  return result;
}

/** True when nothing at all was captured — callers can skip a `$set` write
 * entirely rather than persisting an empty `{}` sub-object. */
export function isEmptyCfFingerprint(cf: CfFingerprint): boolean {
  return Object.keys(cf).length === 0;
}

/** Cloudflare Bot Management scores this low are "very likely automated."
 * Conservative threshold (Cloudflare's own docs treat <30 as suspicious) —
 * exposed here as a pure per-account (not pairwise/link) flag helper for
 * admin/moderator surfaces to consume; not wired into the pairwise alt
 * scoring model, which only ever links two ACCOUNTS, not one account to a
 * "this looks automated" verdict. */
export const HIGH_BOT_SCORE_THRESHOLD = 30;

/** True when a captured bot score is low enough to surface as a per-account
 * "likely automated" flag. `undefined`/absent score never flags. */
export function isHighBotScoreFlag(cf: CfFingerprint | undefined | null): boolean {
  return typeof cf?.botScore === "number" && cf.botScore < HIGH_BOT_SCORE_THRESHOLD;
}

/** Mask a JA4/JA3 value for display in forensic surfaces — mirrors
 * `maskFingerprint` in `src/lib/altDetection/signals.ts` (short prefix +
 * ellipsis, never the full hash to a moderator-tier viewer). */
export function maskJa4(ja4: string): string {
  return ja4.length <= 10 ? `${ja4}…` : `${ja4.slice(0, 10)}…`;
}
