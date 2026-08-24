import { headers } from "next/headers";
import { timingSafeCompare } from "@/lib/api/timingSafeCompare";

// Loose IPv4/IPv6 shape check - just enough to reject empty strings, header
// injection garbage, and multi-token junk that split(",") missed.
const IP_SHAPE = /^[0-9a-fA-F:.]+$/;

// Header Cloudflare attaches to every request it proxies to origin (Transform
// Rule, see PR deployment steps). Its presence proves the request traversed
// the Cloudflare edge instead of hitting the Railway origin directly, because
// the value is only known to Cloudflare config and the server environment.
const CF_ORIGIN_SECRET_HEADER = "x-cf-origin-secret";

function firstValidIp(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const candidate = headerValue.split(",")[0]?.trim();
  return candidate && IP_SHAPE.test(candidate) ? candidate : null;
}

/**
 * Whether cf-connecting-ip may be trusted on this request.
 *
 * Legacy path: with CF_ORIGIN_SECRET unset (local dev, tests, un-migrated
 * deploys) the header is trusted unconditionally, preserving prior behavior.
 * Hardened path: with the secret set, trust it only when the request carries a
 * matching x-cf-origin-secret header that only Cloudflare can inject.
 *
 * timingSafeCompare short-circuits on unequal string length, but the crypto
 * primitive underneath still throws on unequal BYTE length (a same-length
 * string containing a multibyte char). The attacker controls the header value,
 * so any throw is caught and treated as "not trusted" - failing closed to the
 * x-forwarded-for path rather than 500-ing the auth route.
 */
function cfConnectingIpTrusted(originSecretHeader: string | null): boolean {
  const secret = process.env.CF_ORIGIN_SECRET;
  if (!secret) return true;
  if (!originSecretHeader) return false;
  try {
    return timingSafeCompare(secret, originSecretHeader);
  } catch {
    return false;
  }
}

/**
 * Resolve the real client IP from proxy headers.
 *
 * `cf-connecting-ip` is set by Cloudflare from the actual TCP connection to
 * its edge, making it the most accurate signal for security decisions (alt
 * detection, rate limiting) - but ONLY for requests that actually went
 * through Cloudflare. The Railway origin is directly reachable via the
 * *.railway.app hostname, which bypasses the edge entirely, and Railway
 * neither sets nor strips `cf-connecting-ip`, so on direct hits the header is
 * fully attacker-chosen. When CF_ORIGIN_SECRET is configured, the header is
 * therefore trusted only alongside a matching secret header that only
 * Cloudflare can inject; direct-origin requests fall through to
 * `x-forwarded-for`, whose first hop Railway's edge normalizes to the real
 * socket IP of the connecting client (verified against production).
 *
 * With CF_ORIGIN_SECRET unset (local dev, tests, un-migrated deploys) the old
 * unconditional precedence is kept so nothing breaks. That legacy path is
 * insecure wherever the origin is publicly reachable and should be migrated.
 *
 * Historical note: blindly trusting `x-forwarded-for` here previously recorded
 * Cloudflare edge IPs (172.x/162.x ranges) as "the user's IP" for traffic that
 * did come through the edge, producing false alt-account matches between
 * unrelated players who shared a Cloudflare colo. That is why the XFF
 * fallback is only reached for direct-origin traffic, where Railway controls
 * the first hop.
 */
function resolveClientIp(
  cfConnectingIp: string | null,
  forwardedFor: string | null,
  realIp: string | null,
  originSecretHeader: string | null
): string {
  const cfTrusted = cfConnectingIpTrusted(originSecretHeader);
  return (
    (cfTrusted ? firstValidIp(cfConnectingIp) : null) ??
    firstValidIp(forwardedFor) ??
    firstValidIp(realIp) ??
    "unknown"
  );
}

/**
 * Get client IP from request headers
 * Checks common proxy headers in order of preference
 */
export async function getClientIp(): Promise<string> {
  const headersList = await headers();
  return resolveClientIp(
    headersList.get("cf-connecting-ip"),
    headersList.get("x-forwarded-for"),
    headersList.get("x-real-ip"),
    headersList.get(CF_ORIGIN_SECRET_HEADER)
  );
}

/**
 * Get client IP from a Request's headers (route-handler context, where the
 * `Request` is in hand rather than the async `headers()` store). Same proxy
 * header precedence as {@link getClientIp}.
 */
export function clientIpFromRequest(request: Request): string {
  return resolveClientIp(
    request.headers.get("cf-connecting-ip"),
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-real-ip"),
    request.headers.get(CF_ORIGIN_SECRET_HEADER)
  );
}

/**
 * Get the base URL for redirects. Prefers NEXT_PUBLIC_BASE_URL, falls back to request origin.
 */
export function getBaseUrl(request?: Request): string {
  const envBase = process.env.NEXT_PUBLIC_BASE_URL;
  if (envBase && envBase.startsWith("http")) {
    return envBase.replace(/\/$/, "");
  }
  if (request) {
    try {
      const url = new URL(request.url);
      return `${url.protocol}//${url.host}`;
    } catch {
      // ignore
    }
  }
  return "http://localhost:3000";
}
