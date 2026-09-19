import type { ObjectId } from "mongodb";
import type { AltSignal } from "@/lib/db/types/altDetection";
import type { StoredFingerprintComponents } from "@/lib/utils/fingerprint";
import { isCloudflareEdgeIp } from "@/lib/utils/cloudflareIpRanges";
import { isDegenerateFingerprint } from "@/lib/utils/degenerateFingerprints";
import { anchorComponentsMatch } from "@/lib/turn/suspiciousDetection";
import {
  analyzeSessionInterleave,
  buildActivityRhythm,
  buildSessions,
  compareActivityRhythm,
  MIN_RHYTHM_SIMILARITY,
} from "./behavior";

/**
 * Alt-detection signal registry (forensics/alt-detection rework plan §3.2,
 * Phase 5 T5.1). Each entry is a PURE evaluator: given two candidate facets
 * (order-independent) plus the configured weight for this run, it returns
 * either `null` (signal not applicable to this pair — no evidence at all) or
 * a {@link SignalMatch} describing the effective weight and human-readable,
 * PII-masked evidence.
 *
 * Guards (CF-edge IP, degenerate fingerprint) are NOT modeled as "no match" —
 * they return an explicit `weight: 0` match so the evidence is still visible
 * ("we checked and guarded this to zero"), matching plan §4.8's acceptance
 * criterion that false-positive guards must be visible in the UI. A
 * zero-weight signal is a no-op in the noisy-OR aggregate (see `score.ts`),
 * so this costs nothing numerically.
 *
 * DB reads/candidate assembly are Phase 6 (`src/lib/altDetection/run.ts`,
 * a later agent) — this module only consumes the {@link AltCandidateFacet}
 * shape below, which Phase 6 populates from `users`/`activityLog`/
 * `financialTxLog`/`actionAuditLog`.
 */

// ─── Candidate facet (pure input shape) ────────────────────────────────────

/** One IP address observed for a user, with the intel needed to apply the
 * CF-edge (zero) and datacenter/CGNAT (capped) guards, and to drive the
 * `ip_intelligence`/`impossible_travel` signals. */
export interface AltIpObservation {
  ip: string;
  at: Date;
  /** Hosting/proxy/VPN-classified per `IpDetails.isHosting`/`isProxy`/`isVpn`
   * (`src/lib/ip/ipteoh.ts`) — a stand-in for "datacenter/CGNAT", which caps
   * (does not zero) the `ip_exact_nonCF` weight, and gates `ip_intelligence`. */
  isDatacenterOrCgnat?: boolean;
  /** ASN/org string (`IpDetails.as`, e.g. `"AS15169 Google LLC"`) when known.
   * Only populated for `registrationIp`/`lastKnownIp` today (the single
   * cached `user.ipDetails` lookup) — historical login-log IPs don't get a
   * live geoip/ASN lookup (rate-limited third-party API), so this is a
   * best-effort field, not comprehensive. Drives `ip_intelligence`: two
   * accounts on DIFFERENT IPs but the SAME hosting/VPN ASN. */
  asn?: string;
  /** Lat/lon for this observation, when known. NOT populated anywhere today
   * — `src/lib/ip/ipteoh.ts`'s `IpApiResponse`/`IpDetails` don't request or
   * store ip-api.com's `lat`/`lon` fields (only country/region/city
   * strings), and there's no per-login-IP geo enrichment pass (only the
   * single most-recent `user.ipDetails` gets looked up at all). Exists so
   * `impossible_travel`'s evaluator is real/testable now and lights up the
   * moment that dataset gap is closed — see that signal's TODO. */
  geo?: { lat: number; lon: number };
}

/** One donate/transfer leg tying this user to a party, for the
 * `coordinated_funding` signal (donate→party→transfer window). */
export interface AltFundingEvent {
  role: "donor" | "recipient";
  counterpartUserId: ObjectId;
  partyId: string;
  amount: number;
  at: Date;
}

/** A direct money-flow edge to another user, for `wire_graph_link`. */
export interface AltWireObservation {
  counterpartUserId: ObjectId;
  count: number;
  totalAmount: number;
  lastAt: Date;
}

/** A behavioral overlap with another user (common attack victims, party-bloc
 * switches, AP-dump target overlap), for `behavioral_similarity`. */
export interface AltBehavioralObservation {
  counterpartUserId: ObjectId;
  kind: "common_attack_victim" | "party_bloc_switch" | "ap_dump_overlap";
  detail: string;
  at?: Date;
}

/** Pure, DB-agnostic per-user facet consumed by the signal registry and
 * `buildLinks.ts`. Phase 6 assembles this from live collections; unit tests
 * build it directly from fixtures. */
export interface AltCandidateFacet {
  userId: ObjectId;
  username?: string;
  isBanned?: boolean;
  // identity (definitive)
  discordId?: string;
  googleId?: string;
  googleEmail?: string;
  deviceKey?: string;
  trackingId?: string;
  /** All known fingerprint hashes (registration + last + history). */
  fingerprints: string[];
  fingerprintComponents?: StoredFingerprintComponents;
  /** Cloudflare edge JA4 (or JA3 fallback) TLS fingerprints observed for
   * this user (`User.registrationCf.ja4` + `User.lastCf.ja4`,
   * `src/lib/utils/cfFingerprint.ts`). Drives `cf_tls_fingerprint`. Empty
   * when the zone/request never exposed a TLS fingerprint header (most
   * local dev, non-Bot-Management Cloudflare plans). */
  cfTlsFingerprints: string[];
  email?: string;
  referredBy?: ObjectId;
  /** Patreon supporter id (`user.patreonUserId`) — same id linked to two
   * accounts means the same payment identity. */
  patreonUserId?: string;
  /** Stripe customer id, for the Lakeside portal subscription path.
   * SCAFFOLD: no `stripeCustomerId` field exists on `User` today —
   * `supporterProvider === "stripe"` records WHICH system granted
   * benefits, not a correlatable customer id. TODO: needs a
   * `stripeCustomerId` persisted on the user doc by the Stripe
   * checkout/webhook flow before this can ever be populated. Always
   * `undefined` from `run.ts`'s `buildCandidateFacets` until then. */
  stripeCustomerId?: string;
  // network
  ips: AltIpObservation[];
  // timing
  loginTimestamps: Date[];
  /** Every observed activity timestamp for this user — logins PLUS game
   * actions (`actionLogs.createdAt`) and audited API calls
   * (`actionAuditLog.ts`). Drives the behavior-tracking signals
   * (`activity_rhythm`, `session_handoff`), which need a much denser
   * timeline than `loginTimestamps` alone provides: a burner that stays
   * logged in for a week produces one login but hundreds of actions.
   * Defaults to empty for fixtures that don't exercise those signals. */
  activityTimestamps?: Date[];
  // money graph
  fundingEvents: AltFundingEvent[];
  wireEdges: AltWireObservation[];
  // behavioral
  behavioral: AltBehavioralObservation[];
}

// ─── Result + registry shapes ───────────────────────────────────────────────

export interface SignalMatch {
  /** Effective weight for this pair, after guards/caps have been applied.
   * `0` means "matched but guarded to zero" — evidence still explains why. */
  weight: number;
  evidence: string;
  detectedAt: Date;
}

/**
 * Corpus-level context, computed once per scoring run over every candidate.
 * Signals use it to tell an identifying value apart from a common one.
 */
export interface SignalContext {
  /** How many candidates in this run carry each fingerprint hash. */
  fingerprintCounts?: Map<string, number>;
}

/**
 * A fingerprint held by more than this many accounts identifies nobody. Mobile
 * browsers are the usual cause: same handset model, OS and browser build
 * produce an identical ThumbmarkJS hash across unrelated people, and unlike the
 * literal sentinels in DEGENERATE_FINGERPRINTS these are real-looking hashes.
 * Above the ceiling the signal is scored 0 (kept as evidence, not as weight).
 */
export const FINGERPRINT_COMMONNESS_CEILING = 8;

export interface SignalDefinition {
  type: AltSignal;
  /** Weight table default (plan §3.2). Overridable via `gameConfig.altScoring`
   * (`config.ts`); callers pass the resolved weight in, not this field. */
  defaultWeight: number;
  /** Documented ceiling this signal can be capped to under a guard (metadata
   * for the admin config UI; evaluators enforce the actual cap themselves). */
  cap?: number;
  description: string;
  evaluate: (
    a: AltCandidateFacet,
    b: AltCandidateFacet,
    weight: number,
    now: Date,
    ctx?: SignalContext
  ) => SignalMatch | null;
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

// Degenerate-fingerprint helpers live in `@/lib/utils/degenerateFingerprints`
// (shared with `turn/suspiciousDetection`, `altDetection/run` and the auth
// layer's `identitySignals`). Re-exported here for this module's existing
// importers; the value used internally comes from the import at the top.
export { isDegenerateFingerprint } from "@/lib/utils/degenerateFingerprints";

/** Ceiling `ip_exact_nonCF` is capped to when the shared IP is hosting/proxy/
 * VPN-classified (datacenter/CGNAT stand-in) rather than residential/mobile. */
export const IP_DATACENTER_CGNAT_CAP = 0.15;

export function maskIp(ip: string): string {
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `${parts[0] ?? ""}:${parts[1] ?? ""}::xxxx`;
  }
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
  return "xxx.xxx.xxx.xxx";
}

/** First three IPv4 octets, for the `/24` subnet fallback signal. `null` for
 * non-IPv4 (IPv6, malformed) addresses — subnet sharing isn't evaluated there. */
export function subnet24(ip: string): string | null {
  if (ip.includes(":")) return null;
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

export function maskFingerprint(fp: string): string {
  return fp.length <= 8 ? `${fp}…` : `${fp.slice(0, 8)}…`;
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

function splitEmail(email: string): [string, string] | [null, null] {
  const at = email.indexOf("@");
  if (at <= 0) return [null, null];
  return [email.slice(0, at).toLowerCase(), email.slice(at + 1).toLowerCase()];
}

/**
 * Domains where the local part is minted by us or an OAuth provider rather than
 * chosen by the user. Discord sign-up writes `discord<snowflake>@discord.local`,
 * so every Discord account in the game shares the same stem and differs only in
 * the trailing snowflake — which made `email_pattern_family` fire between ANY
 * two Discord users and quietly bond the whole OAuth playerbase into one ring.
 * These carry no correlating information and must never be family-matched.
 */
const SYSTEM_GENERATED_EMAIL_DOMAINS = new Set(["discord.local", "google.local", "oauth.local"]);

export function isSystemGeneratedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return SYSTEM_GENERATED_EMAIL_DOMAINS.has(email.slice(at + 1).toLowerCase());
}

/** Strip Gmail-style `+tag` suffixes and dots, for family comparison. */
function normalizeLocalPart(local: string): string {
  return local.replace(/\+.*$/, "").replace(/\./g, "");
}

// ─── Email intelligence: alias normalization + disposable domains ─────────

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** Small built-in list of well-known disposable/burner email providers.
 * Not exhaustive (a maintained external list would catch more), but covers
 * the common ones burner-account operators reach for. */
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "10minutemail.com",
  "10minutemail.net",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
  "sharklasers.com",
  "dispostable.com",
  "fakeinbox.com",
  "mintemail.com",
  "moakt.com",
  "maildrop.cc",
  "mailnesia.com",
  "spamgourmet.com",
  "discard.email",
  "mohmal.com",
]);

/** True if `domain` (lowercased) is a known disposable/burner email provider. */
export function isDisposableEmailDomain(domain: string): boolean {
  return DISPOSABLE_EMAIL_DOMAINS.has(domain.toLowerCase());
}

/**
 * Normalize an email into the alias-collapsed identity it actually resolves
 * to. Gmail/Googlemail ignore `.` in the local-part entirely and ignore
 * anything after a `+` tag — `a.b+work@gmail.com` and `ab@gmail.com` are
 * literally the SAME inbox, and `googlemail.com` is just Gmail's legacy
 * alias domain. Other providers generally treat dots as significant
 * (Outlook/Yahoo/etc. deliver `a.b@` and `ab@` to different mailboxes) but
 * widely honor `+tag` stripping, so only that half applies for them.
 * Returns `null` for an unparseable address.
 */
export function normalizeEmailAlias(email: string): { local: string; domain: string } | null {
  const [local, domain] = splitEmail(email);
  if (!local || !domain) return null;
  const isGmail = GMAIL_DOMAINS.has(domain);
  const canonicalDomain = isGmail ? "gmail.com" : domain;
  const withoutTag = local.replace(/\+.*$/, "");
  const normalizedLocal = isGmail ? withoutTag.replace(/\./g, "") : withoutTag;
  return { local: normalizedLocal, domain: canonicalDomain };
}

// ─── Impossible travel: haversine distance ─────────────────────────────────

const EARTH_RADIUS_KM = 6371;

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Fastest plausible sustained travel speed (long-haul commercial flight
 * plus a generous buffer). A geo-distance/time ratio above this is
 * physically implausible for one operator to have covered in person. */
const IMPOSSIBLE_TRAVEL_MAX_KMH = 900;

/** Ignore geo pairs closer together than this radius — same metro area, not
 * a travel claim (also absorbs geoip city-centroid imprecision). */
const IMPOSSIBLE_TRAVEL_MIN_KM = 50;

/** Ignore observation pairs closer together in time than this — clock skew
 * and geoip rounding make sub-15-minute deltas too noisy to derive a speed
 * ratio from. */
const IMPOSSIBLE_TRAVEL_MIN_WINDOW_MS = 15 * 60 * 1000;

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prevDiag = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prevDiag : 1 + Math.min(prevDiag, dp[j], dp[j - 1]);
      prevDiag = temp;
    }
  }
  return dp[n];
}

const EMAIL_FAMILY_MAX_DISTANCE = 2;
const FUNDING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days, mirrors detectCoordinatedFunding
const COORDINATED_LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const COORDINATED_LOGIN_MIN_OCCURRENCES = 3;
const LOGIN_CLUSTER_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const LOGIN_CLUSTER_MIN_DAYS = 5;
const LOGIN_CLUSTER_MIN_SPAN_DAYS = 7;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Behavior-profile memoization ──────────────────────────────────────────
//
// `buildLinks` runs the whole registry over every pair, so a 300-candidate
// pool means ~45k evaluations. Rebuilding a facet's rhythm histogram and
// session list on each of them would be O(pairs x events); memoizing per
// FACET makes it O(candidates x events) instead. WeakMaps keyed on the facet
// object keep this free of lifecycle management — the entries die with the
// facets at the end of the run, and a fresh facet object (the next run)
// never sees a stale profile.

const rhythmCache = new WeakMap<AltCandidateFacet, ReturnType<typeof buildActivityRhythm>>();
const sessionCache = new WeakMap<AltCandidateFacet, ReturnType<typeof buildSessions>>();

/** Timestamps backing the behavior signals: the dense activity timeline when
 * `run.ts` populated one, else the login timestamps as a thin fallback. */
function behaviorTimestamps(facet: AltCandidateFacet): Date[] {
  return facet.activityTimestamps && facet.activityTimestamps.length > 0
    ? facet.activityTimestamps
    : facet.loginTimestamps;
}

function facetRhythm(facet: AltCandidateFacet) {
  const cached = rhythmCache.get(facet);
  if (cached) return cached;
  const rhythm = buildActivityRhythm(behaviorTimestamps(facet));
  rhythmCache.set(facet, rhythm);
  return rhythm;
}

/** Most recent behavior timestamp, or 0 when the facet has none. Reduced
 * rather than spread into `Math.max` — see the call site. */
function latestTimestamp(facet: AltCandidateFacet): number {
  let latest = 0;
  for (const ts of behaviorTimestamps(facet)) {
    const ms = ts.getTime();
    if (ms > latest) latest = ms;
  }
  return latest;
}

function facetSessions(facet: AltCandidateFacet) {
  const cached = sessionCache.get(facet);
  if (cached) return cached;
  const sessions = buildSessions(behaviorTimestamps(facet));
  sessionCache.set(facet, sessions);
  return sessions;
}

// ─── Signal registry ─────────────────────────────────────────────────────────

export const ALT_SIGNAL_REGISTRY: SignalDefinition[] = [
  {
    type: "oauth_shared",
    defaultWeight: 0.97,
    description: "Same Discord/Google account linked to both users — definitive.",
    evaluate: (a, b, weight, now) => {
      if (a.discordId && a.discordId === b.discordId) {
        return { weight, evidence: "Shared Discord account link", detectedAt: now };
      }
      if (a.googleId && a.googleId === b.googleId) {
        return { weight, evidence: "Shared Google account link", detectedAt: now };
      }
      if (
        a.googleEmail &&
        b.googleEmail &&
        a.googleEmail.toLowerCase() === b.googleEmail.toLowerCase()
      ) {
        return {
          weight,
          evidence: `Shared Google email (${maskEmail(a.googleEmail)})`,
          detectedAt: now,
        };
      }
      return null;
    },
  },
  {
    type: "device_fingerprint_exact",
    defaultWeight: 0.95,
    description: "Exact ThumbmarkJS fingerprint hash shared. Degenerate/fallback hashes → 0.",
    evaluate: (a, b, weight, now, ctx) => {
      const shared = a.fingerprints.filter((fp) => b.fingerprints.includes(fp));
      if (shared.length === 0) return null;
      const counts = ctx?.fingerprintCounts;
      const isCommon = (fp: string) => (counts?.get(fp) ?? 0) > FINGERPRINT_COMMONNESS_CEILING;
      const strong = shared.filter((fp) => !isDegenerateFingerprint(fp) && !isCommon(fp));
      if (strong.length === 0 && shared.some(isCommon)) {
        const worst = shared.reduce((m, fp) => Math.max(m, counts?.get(fp) ?? 0), 0);
        return {
          weight: 0,
          evidence: `Shared fingerprint is common to ${worst} accounts (${maskFingerprint(shared[0])}) — too widespread to identify anyone, not counted as ring evidence`,
          detectedAt: now,
        };
      }
      if (strong.length === 0) {
        return {
          weight: 0,
          evidence: `Shared fingerprint is degenerate/fallback (${shared.length} match${shared.length === 1 ? "" : "es"}) — not counted as ring evidence`,
          detectedAt: now,
        };
      }
      return {
        weight,
        evidence: `Exact device fingerprint match (${maskFingerprint(strong[0])}, ${strong.length} shared hash${strong.length === 1 ? "" : "es"})`,
        detectedAt: now,
      };
    },
  },
  {
    type: "deviceKey_exact",
    defaultWeight: 0.93,
    description: "Same localStorage device key (survives cookie clears).",
    evaluate: (a, b, weight, now) => {
      if (!a.deviceKey || !b.deviceKey || a.deviceKey !== b.deviceKey) return null;
      return { weight, evidence: "Shared device key", detectedAt: now };
    },
  },
  {
    type: "trackingId_exact",
    defaultWeight: 0.9,
    description: "Same browser tracking cookie.",
    evaluate: (a, b, weight, now) => {
      if (!a.trackingId || !b.trackingId || a.trackingId !== b.trackingId) return null;
      return { weight, evidence: "Shared browser tracking cookie", detectedAt: now };
    },
  },
  {
    type: "device_fingerprint_fuzzy",
    defaultWeight: 0.55,
    description:
      "Hardware-anchor fuzzy match (canvas/webgl/audio equal, <=1 secondary drift). Superseded by an exact non-degenerate match.",
    evaluate: (a, b, weight, now) => {
      const exactShared = a.fingerprints.filter((fp) => b.fingerprints.includes(fp));
      const hasStrongExact = exactShared.some((fp) => !isDegenerateFingerprint(fp));
      if (hasStrongExact) return null;
      if (!anchorComponentsMatch(a.fingerprintComponents, b.fingerprintComponents)) return null;
      return {
        weight,
        evidence: "Near-identical device fingerprint (hardware anchors: canvas/WebGL/audio match)",
        detectedAt: now,
      };
    },
  },
  {
    type: "coordinated_funding",
    defaultWeight: 0.6,
    description: "Donate→party→transfer within a 3-day window between the two accounts.",
    evaluate: (a, b, weight) => {
      for (const fa of a.fundingEvents) {
        if (!fa.counterpartUserId.equals(b.userId)) continue;
        for (const fb of b.fundingEvents) {
          if (!fb.counterpartUserId.equals(a.userId)) continue;
          if (fa.role === fb.role) continue;
          if (fa.partyId !== fb.partyId) continue;
          const delta = Math.abs(fa.at.getTime() - fb.at.getTime());
          if (delta > FUNDING_WINDOW_MS) continue;
          const donor = fa.role === "donor" ? a : b;
          const recipient = fa.role === "donor" ? b : a;
          return {
            weight,
            evidence: `Coordinated funding via party ${fa.partyId}: ${donor.username ?? donor.userId.toString()} donated, ${recipient.username ?? recipient.userId.toString()} received within ${Math.max(1, Math.round(delta / 3_600_000))}h`,
            detectedAt: new Date(Math.max(fa.at.getTime(), fb.at.getTime())),
          };
        }
      }
      return null;
    },
  },
  {
    type: "wire_graph_link",
    defaultWeight: 0.35,
    description:
      "Direct pairwise wire/transfer flow. Boosted when corroborated by device/IP (buildLinks).",
    evaluate: (a, b, weight) => {
      const edge =
        a.wireEdges.find((e) => e.counterpartUserId.equals(b.userId)) ??
        b.wireEdges.find((e) => e.counterpartUserId.equals(a.userId));
      if (!edge) return null;
      return {
        weight,
        evidence: `Direct wire/transfer flow between accounts (${edge.count} transaction${edge.count === 1 ? "" : "s"})`,
        detectedAt: edge.lastAt,
      };
    },
  },
  {
    type: "ip_exact_nonCF",
    defaultWeight: 0.35,
    cap: IP_DATACENTER_CGNAT_CAP,
    description: "Shared non-Cloudflare-edge IP. CF-edge → 0; datacenter/CGNAT capped to 0.15.",
    evaluate: (a, b, weight, now) => {
      const bByIp = new Map(b.ips.map((o) => [o.ip, o]));
      const shared = a.ips.filter((o) => bByIp.has(o.ip));
      if (shared.length === 0) return null;
      const nonEdge = shared.filter((o) => !isCloudflareEdgeIp(o.ip));
      if (nonEdge.length === 0) {
        return {
          weight: 0,
          evidence: `Shared IP is Cloudflare edge (${shared.length} match${shared.length === 1 ? "" : "es"}) — excluded from scoring`,
          detectedAt: now,
        };
      }
      const isCapped = nonEdge.some(
        (o) => o.isDatacenterOrCgnat || bByIp.get(o.ip)?.isDatacenterOrCgnat
      );
      const effectiveWeight = isCapped ? Math.min(weight, IP_DATACENTER_CGNAT_CAP) : weight;
      const latest = nonEdge.reduce(
        (max, o) => (o.at.getTime() > max.getTime() ? o.at : max),
        nonEdge[0].at
      );
      return {
        weight: effectiveWeight,
        evidence: `Shared ${isCapped ? "datacenter/CGNAT" : "residential/mobile"} IP ${maskIp(nonEdge[0].ip)}${nonEdge.length > 1 ? ` (+${nonEdge.length - 1} more)` : ""}`,
        detectedAt: latest,
      };
    },
  },
  {
    type: "ip_intelligence",
    defaultWeight: 0.2,
    description:
      "Distinct IPs (not an exact match — that's `ip_exact_nonCF`) on the same hosting/VPN/proxy/datacenter ASN. Weaker than an exact shared IP since a hosting provider's address pool is shared by many unrelated users; only evaluated for non-residential (datacenter/CGNAT-classified) IPs, and skipped entirely when an exact non-CF-edge IP match already fired for the pair.",
    evaluate: (a, b, weight) => {
      const bByIp = new Map(b.ips.map((o) => [o.ip, o]));
      const hasExactNonEdge = a.ips.some((o) => bByIp.has(o.ip) && !isCloudflareEdgeIp(o.ip));
      if (hasExactNonEdge) return null;

      const bByAsn = new Map<string, AltIpObservation>();
      for (const o of b.ips) {
        if (!o.asn || !o.isDatacenterOrCgnat || isCloudflareEdgeIp(o.ip)) continue;
        if (!bByAsn.has(o.asn)) bByAsn.set(o.asn, o);
      }
      for (const o of a.ips) {
        if (!o.asn || !o.isDatacenterOrCgnat || isCloudflareEdgeIp(o.ip)) continue;
        const match = bByAsn.get(o.asn);
        if (!match) continue;
        return {
          weight,
          evidence: `Both accounts use distinct IPs on the same hosting/VPN provider network (${o.asn})`,
          detectedAt: o.at.getTime() > match.at.getTime() ? o.at : match.at,
        };
      }
      return null;
    },
  },
  {
    type: "impossible_travel",
    defaultWeight: 0.5,
    description:
      "Two accounts' login IPs geolocate far enough apart that the observed gap between logins implies a physically impossible travel speed (>900 km/h). SCAFFOLD: needs per-observation lat/lon (`AltIpObservation.geo`), which `run.ts`'s `buildCandidateFacets` does not populate today. TODO: needs an IP-geolocation dataset with coordinates — `src/lib/ip/ipteoh.ts` already calls ip-api.com (which supports `lat`,`lon` response fields) but `IpApiResponse`/`IpDetails` only request/store country/region/city strings today, and there's no per-login-IP geo enrichment pass (only the single most-recent `user.ipDetails` is looked up at all). The evaluator itself is fully implemented and tested against injected `geo` fixtures — it will start firing for real the moment that dataset gap closes.",
    evaluate: (a, b, weight) => {
      let best: { kmh: number; at: Date } | null = null;
      for (const oa of a.ips) {
        if (!oa.geo) continue;
        for (const ob of b.ips) {
          if (!ob.geo) continue;
          const deltaMs = Math.abs(oa.at.getTime() - ob.at.getTime());
          if (deltaMs < IMPOSSIBLE_TRAVEL_MIN_WINDOW_MS) continue;
          const km = haversineKm(oa.geo, ob.geo);
          if (km < IMPOSSIBLE_TRAVEL_MIN_KM) continue;
          const kmh = km / (deltaMs / 3_600_000);
          if (kmh <= IMPOSSIBLE_TRAVEL_MAX_KMH) continue;
          const at = oa.at.getTime() > ob.at.getTime() ? oa.at : ob.at;
          if (!best || kmh > best.kmh) best = { kmh, at };
        }
      }
      if (!best) return null;
      return {
        weight,
        evidence: `Logins imply ~${Math.round(best.kmh).toLocaleString()} km/h of travel between the two accounts' IP locations — physically implausible`,
        detectedAt: best.at,
      };
    },
  },
  {
    type: "coordinated_login_timing",
    defaultWeight: 0.35,
    description: "3+ logins within a 15-minute window of each other.",
    evaluate: (a, b, weight) => {
      let count = 0;
      let maxTs = 0;
      for (const ta of a.loginTimestamps) {
        for (const tb of b.loginTimestamps) {
          if (Math.abs(ta.getTime() - tb.getTime()) <= COORDINATED_LOGIN_WINDOW_MS) {
            count++;
            maxTs = Math.max(maxTs, ta.getTime(), tb.getTime());
          }
        }
      }
      if (count < COORDINATED_LOGIN_MIN_OCCURRENCES) return null;
      return {
        weight,
        evidence: `${count} logins within a 15-minute window of each other`,
        detectedAt: new Date(maxTs),
      };
    },
  },
  {
    type: "login_time_cluster",
    defaultWeight: 0.3,
    description:
      "Logins within 30 minutes of each other on 5+ distinct days spanning >=7 days (survives IP change).",
    evaluate: (a, b, weight) => {
      const matchedDays = new Set<string>();
      let maxTs = 0;
      for (const ta of a.loginTimestamps) {
        for (const tb of b.loginTimestamps) {
          if (Math.abs(ta.getTime() - tb.getTime()) <= LOGIN_CLUSTER_WINDOW_MS) {
            matchedDays.add(dayKey(ta));
            maxTs = Math.max(maxTs, ta.getTime(), tb.getTime());
          }
        }
      }
      if (matchedDays.size < LOGIN_CLUSTER_MIN_DAYS) return null;
      const days = [...matchedDays].sort();
      const spanDays =
        (new Date(days[days.length - 1]).getTime() - new Date(days[0]).getTime()) / 86_400_000;
      if (spanDays < LOGIN_CLUSTER_MIN_SPAN_DAYS) return null;
      return {
        weight,
        evidence: `Logged in within 30 minutes of each other on ${matchedDays.size} distinct days over a ${Math.round(spanDays)}-day span`,
        detectedAt: new Date(maxTs),
      };
    },
  },
  {
    type: "behavioral_similarity",
    defaultWeight: 0.3,
    description: "Common attack victims, party-bloc switches, or AP-dump target overlap.",
    evaluate: (a, b, weight, now) => {
      const matches = a.behavioral.filter((o) => o.counterpartUserId.equals(b.userId));
      if (matches.length === 0) return null;
      const kinds = [...new Set(matches.map((m) => m.kind))];
      const latest = matches.reduce((max, m) => (m.at && m.at > max ? m.at : max), now);
      return {
        weight,
        evidence: `Behavioral overlap: ${kinds.join(", ")} (${matches
          .slice(0, 2)
          .map((m) => m.detail)
          .join("; ")})`,
        detectedAt: latest,
      };
    },
  },
  {
    type: "email_pattern_family",
    defaultWeight: 0.3,
    description: "Email local-parts in the same family (edit-distance/prefix), same domain.",
    evaluate: (a, b, weight, now) => {
      if (!a.email || !b.email) return null;
      // Provider-minted placeholders share a stem by construction — see
      // SYSTEM_GENERATED_EMAIL_DOMAINS.
      if (isSystemGeneratedEmail(a.email) || isSystemGeneratedEmail(b.email)) return null;
      const [aLocal, aDomain] = splitEmail(a.email);
      const [bLocal, bDomain] = splitEmail(b.email);
      if (!aLocal || !bLocal || !aDomain || aDomain !== bDomain) return null;
      if (aLocal === bLocal) return null; // identical is a duplicate-account concern, not "family"
      const na = normalizeLocalPart(aLocal);
      const nb = normalizeLocalPart(bLocal);
      if (!na || !nb) return null;
      const dist = levenshtein(na, nb);
      const sameNumericStrippedStem = na.replace(/\d+$/, "") === nb.replace(/\d+$/, "");
      if (dist > EMAIL_FAMILY_MAX_DISTANCE && !sameNumericStrippedStem) return null;
      return {
        weight,
        evidence: `Email local-parts look related (${maskEmail(a.email)} / ${maskEmail(b.email)})`,
        detectedAt: now,
      };
    },
  },
  {
    type: "email_alias_match",
    defaultWeight: 0.85,
    description:
      "Same underlying inbox after alias normalization (Gmail dot/plus stripping, or +tag stripping elsewhere) — the two raw addresses differ but resolve to the same mailbox. Near-definitive: same-normalized-email across accounts is strong evidence. Flags a shared disposable-email provider in the evidence when relevant.",
    evaluate: (a, b, weight, now) => {
      if (!a.email || !b.email) return null;
      if (a.email.toLowerCase() === b.email.toLowerCase()) return null; // identical raw email; guarded even though the schema shouldn't allow two accounts to share one
      const na = normalizeEmailAlias(a.email);
      const nb = normalizeEmailAlias(b.email);
      if (!na || !nb || !na.local || !nb.local) return null;
      if (na.domain !== nb.domain || na.local !== nb.local) return null;
      const disposable = isDisposableEmailDomain(na.domain);
      return {
        weight,
        evidence: `Same email inbox after alias normalization (${maskEmail(a.email)} / ${maskEmail(b.email)})${disposable ? " — disposable email domain" : ""}`,
        detectedAt: now,
      };
    },
  },
  {
    type: "payment_correlation",
    defaultWeight: 0.92,
    description:
      "Same Patreon supporter id, or same Stripe customer id, linked to both accounts — near-definitive (same payment identity/instrument). Stripe correlation is SCAFFOLDED: no `stripeCustomerId` field exists on `User` today (`supporterProvider` records WHICH system granted benefits, not a correlatable customer id) — TODO: needs a `stripeCustomerId` persisted on the user doc by the Lakeside Stripe checkout/webhook flow before `AltCandidateFacet.stripeCustomerId` can ever be populated.",
    evaluate: (a, b, weight, now) => {
      if (a.patreonUserId && a.patreonUserId === b.patreonUserId) {
        return {
          weight,
          evidence: "Same Patreon supporter account linked to both users",
          detectedAt: now,
        };
      }
      if (a.stripeCustomerId && a.stripeCustomerId === b.stripeCustomerId) {
        return {
          weight,
          evidence: "Same Stripe customer id linked to both users",
          detectedAt: now,
        };
      }
      return null;
    },
  },
  {
    type: "referral_link",
    defaultWeight: 0.15,
    cap: 0.45,
    description:
      "referredBy chain between the two accounts. Escalated to 0.45 inside a burner cluster with a banned sibling (buildLinks).",
    evaluate: (a, b, weight, now) => {
      if (a.referredBy?.equals(b.userId)) {
        return {
          weight,
          evidence: `${a.username ?? a.userId.toString()} was referred by ${b.username ?? b.userId.toString()}`,
          detectedAt: now,
        };
      }
      if (b.referredBy?.equals(a.userId)) {
        return {
          weight,
          evidence: `${b.username ?? b.userId.toString()} was referred by ${a.username ?? a.userId.toString()}`,
          detectedAt: now,
        };
      }
      return null;
    },
  },
  {
    type: "subnet_/24_share",
    defaultWeight: 0.15,
    description: "Shared IPv4 /24 subnet, only when no exact non-CF-edge IP match already fired.",
    evaluate: (a, b, weight) => {
      const bByIp = new Map(b.ips.map((o) => [o.ip, o]));
      const hasExactNonEdge = a.ips.some((o) => bByIp.has(o.ip) && !isCloudflareEdgeIp(o.ip));
      if (hasExactNonEdge) return null;

      const bSubnets = new Map<string, AltIpObservation>();
      for (const o of b.ips) {
        if (isCloudflareEdgeIp(o.ip)) continue;
        const s = subnet24(o.ip);
        if (s && !bSubnets.has(s)) bSubnets.set(s, o);
      }
      for (const o of a.ips) {
        if (isCloudflareEdgeIp(o.ip)) continue;
        const s = subnet24(o.ip);
        if (!s) continue;
        const match = bSubnets.get(s);
        if (match) {
          return {
            weight,
            evidence: `Shared /24 subnet ${s}.0/24`,
            detectedAt: o.at.getTime() > match.at.getTime() ? o.at : match.at,
          };
        }
      }
      return null;
    },
  },
  {
    type: "cf_tls_fingerprint",
    defaultWeight: 0.75,
    description:
      "Same Cloudflare edge JA4/JA3 TLS ClientHello fingerprint across both accounts (src/lib/utils/cfFingerprint.ts). Survives cookie clears and incognito mode, unlike device_fingerprint_exact — but it is COARSER: many unrelated users on the same browser/OS build share an identical JA4, so it is scored strong, not definitive. Only present when the Cloudflare zone exposes a Bot Management JA4/JA3 header.",
    evaluate: (a, b, weight, now) => {
      const shared = a.cfTlsFingerprints.filter((ja4) => b.cfTlsFingerprints.includes(ja4));
      if (shared.length === 0) return null;
      return {
        weight,
        evidence: `Shared Cloudflare TLS (JA4) fingerprint (${maskFingerprint(shared[0])})`,
        detectedAt: now,
      };
    },
  },
  {
    type: "session_handoff",
    defaultWeight: 0.45,
    description:
      "Sessions that alternate tightly (one account's session ends, the other's begins within 10 minutes) across 4+ transitions with effectively NO concurrent online time — the signature of one operator switching between two logins rather than two people who play at similar times. Behavior-only: survives a new device, a cleared browser, and a VPN, because it correlates when a human is at the keyboard rather than any identity token. See `src/lib/altDetection/behavior.ts` for the guards.",
    evaluate: (a, b, weight) => {
      const sessionsA = facetSessions(a);
      const sessionsB = facetSessions(b);
      if (sessionsA.length === 0 || sessionsB.length === 0) return null;

      const result = analyzeSessionInterleave(sessionsA, sessionsB);
      if (!result.qualifies) {
        // Only surface the near-miss where the alternation pattern was real
        // but concurrent activity refuted it — that's an actively useful
        // "we checked and ruled this out" note for a moderator staring at a
        // pair that otherwise looks like a ring. The other two rejection
        // reasons (too few sessions/handoffs) are just "no data", and
        // emitting them for every quiet pair would bury the UI.
        if (result.reason !== "concurrent_activity") return null;
        return {
          weight: 0,
          evidence: `${result.handoffs} session handoffs, but the accounts were online at the same time for ${Math.round(result.overlapMinutes)} min — ruled out as a single-operator pattern`,
          detectedAt: sessionsA[sessionsA.length - 1].end,
        };
      }

      const latest = Math.max(
        sessionsA[sessionsA.length - 1].end.getTime(),
        sessionsB[sessionsB.length - 1].end.getTime()
      );
      return {
        weight,
        evidence: `${result.handoffs} tight session handoffs (longest alternating run: ${result.longestAlternation}) with no concurrent online time — consistent with one operator alternating accounts`,
        detectedAt: new Date(latest),
      };
    },
  },
  {
    type: "activity_rhythm",
    defaultWeight: 0.25,
    description:
      "Near-identical hour-of-day and day-of-week activity histograms. Weak by design and heavily guarded: only compared when BOTH accounts have 25+ events AND both activity profiles are concentrated (normalized hour entropy <= 0.82), because two unrelated players who both play evenings would otherwise match. Corroborating evidence only — it is the shape of a schedule, not an identity.",
    evaluate: (a, b, weight) => {
      const rhythmA = facetRhythm(a);
      const rhythmB = facetRhythm(b);
      const comparison = compareActivityRhythm(rhythmA, rhythmB);
      if (!comparison.comparable) return null;
      if (comparison.combined < MIN_RHYTHM_SIMILARITY) return null;

      const peakHour = rhythmA.hours.indexOf(Math.max(...rhythmA.hours));
      return {
        weight,
        evidence: `Near-identical activity rhythm (${Math.round(comparison.combined * 100)}% match over ${rhythmA.total}/${rhythmB.total} events, both concentrated around ${peakHour.toString().padStart(2, "0")}:00 UTC)`,
        // Reduced, not spread into `Math.max` — a high-volume account can
        // carry tens of thousands of activity timestamps, and spreading an
        // array that size overflows the argument limit and throws.
        detectedAt: new Date(Math.max(latestTimestamp(a), latestTimestamp(b))),
      };
    },
  },
];

export function getSignalDefinition(type: AltSignal): SignalDefinition | undefined {
  return ALT_SIGNAL_REGISTRY.find((def) => def.type === type);
}
