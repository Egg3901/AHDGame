/**
 * IP Threat & Endpoint Observable Hub (IPTEOH)
 *
 * Detects VPN/proxy/hosting usage via ip-api.com (free, 45 req/min).
 * Caches results in MongoDB to avoid repeat lookups.
 * Non-blocking — all callers fire-and-forget; failures are silently swallowed.
 */

import { getDb } from "@/lib/mongodb";
import { normalizeIp } from "@/lib/utils/ipNormalize";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Structured IP intelligence stored on the user doc. */
export interface IpDetails {
  checkedAt: Date;
  ip: string;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  isp: string | null;
  org: string | null;
  as: string | null;
  isVpn: boolean;
  isProxy: boolean;
  isHosting: boolean;
  raw?: Record<string, unknown>;
}

/** Shape of the ip-api.com response. */
interface IpApiResponse {
  status: string;
  query?: string;
  country?: string;
  regionName?: string;
  city?: string;
  timezone?: string;
  isp?: string;
  org?: string;
  as?: string;
  proxy?: boolean;
  hosting?: boolean;
}

/** MongoDB cache document. */
interface IpGeoCacheDoc {
  _id: string; // normalized IP
  data: IpDetails;
  checkedAt: Date;
  expiresAt: Date;
}

// ── Config ────────────────────────────────────────────────────────────────────

const CACHE_TTL_DAYS = 30;
const API_TIMEOUT_MS = 5_000;

/** Per-process rate limiter: max 1 request per 1.5s (45/min minus headroom). */
let lastRequestAt = 0;
const MIN_INTERVAL_MS = 1_500;

// ── Cache ─────────────────────────────────────────────────────────────────────

async function getCached(ip: string): Promise<IpDetails | null> {
  try {
    const db = await getDb();
    const doc = await db.collection<IpGeoCacheDoc>("ipGeoCache").findOne({ _id: ip });
    return doc?.data ?? null;
  } catch {
    return null;
  }
}

async function setCache(ip: string, data: IpDetails): Promise<void> {
  try {
    const db = await getDb();
    const now = new Date();
    await db.collection<IpGeoCacheDoc>("ipGeoCache").updateOne(
      { _id: ip },
      {
        $set: {
          _id: ip,
          data,
          checkedAt: now,
          expiresAt: new Date(now.getTime() + CACHE_TTL_DAYS * 86_400_000),
        },
      },
      { upsert: true }
    );
  } catch {
    // cache write failure is non-fatal
  }
}

// ── Rate Limiter ──────────────────────────────────────────────────────────────

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

// ── API ───────────────────────────────────────────────────────────────────────

function parseResponse(raw: IpApiResponse, queriedIp: string): IpDetails {
  return {
    checkedAt: new Date(),
    ip: raw.query ?? queriedIp,
    country: raw.country ?? null,
    region: raw.regionName ?? null,
    city: raw.city ?? null,
    timezone: raw.timezone ?? null,
    isp: raw.isp ?? null,
    org: raw.org ?? null,
    as: raw.as ?? null,
    // ip-api.com 'proxy' covers VPN, proxy, and Tor — no separate Tor field
    isVpn: raw.proxy ?? false,
    isProxy: raw.proxy ?? false,
    isHosting: raw.hosting ?? false,
    raw: raw as unknown as Record<string, unknown>,
  };
}

async function fetchFromApi(ip: string): Promise<IpDetails | null> {
  const url =
    "http://ip-api.com/json/" +
    ip +
    "?fields=status,country,regionName,city,timezone,isp,org,as,proxy,hosting,query";

  try {
    await waitForRateLimit();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const raw: IpApiResponse = await res.json();
    if (raw.status !== "success") return null;

    return parseResponse(raw, ip);
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Look up IP intelligence for the given IP address.
 * Checks MongoDB cache first, then hits ip-api.com if needed.
 * Returns null on any failure (invalid IP, API error, rate limit).
 *
 * Safe to call from fire-and-forget contexts — never throws.
 */
export async function checkIp(rawIp: string): Promise<IpDetails | null> {
  const ip = normalizeIp(rawIp);
  if (!ip) return null;

  // Skip private/loopback IPs
  if (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("172.16.")
  ) {
    return null;
  }

  // Check cache
  const cached = await getCached(ip);
  if (cached) return cached;

  // Fetch from API
  const result = await fetchFromApi(ip);
  if (!result) return null;

  // Cache for next time
  await setCache(ip, result);

  return result;
}

/**
 * Fire-and-forget wrapper. Never throws — designed for use in
 * registration/login flows where IP detection must not block the happy path.
 */
export async function checkIpFireAndForget(rawIp: string): Promise<IpDetails | null> {
  try {
    return await checkIp(rawIp);
  } catch {
    return null;
  }
}
