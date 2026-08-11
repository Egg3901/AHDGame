import { headers } from "next/headers";

// Loose IPv4/IPv6 shape check — just enough to reject empty strings, header
// injection garbage, and multi-token junk that split(",") missed.
const IP_SHAPE = /^[0-9a-fA-F:.]+$/;

function firstValidIp(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const candidate = headerValue.split(",")[0]?.trim();
  return candidate && IP_SHAPE.test(candidate) ? candidate : null;
}

/**
 * Resolve the real client IP from proxy headers. All traffic is fronted by
 * Cloudflare, which sets `cf-connecting-ip` from the actual TCP connection to
 * its edge — the client cannot forge this header, Cloudflare overwrites
 * whatever the client sent before proxying to origin. That makes it the only
 * header here safe to trust for security/anti-abuse decisions (alt detection,
 * rate limiting), so it takes priority.
 *
 * `x-forwarded-for` is a fallback for non-Cloudflare-fronted contexts (local
 * dev, direct origin access) only — it is client-controllable and, in this
 * deployment, its first hop is the intermediate proxy's own address rather
 * than the browser's, which is what caused Cloudflare edge IPs (172.x/162.x
 * ranges) to be recorded as "the user's IP" and produce false alt-account
 * matches between unrelated players who shared a Cloudflare colo.
 */
function resolveClientIp(
  cfConnectingIp: string | null,
  forwardedFor: string | null,
  realIp: string | null
): string {
  return (
    firstValidIp(cfConnectingIp) ?? firstValidIp(forwardedFor) ?? firstValidIp(realIp) ?? "unknown"
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
    headersList.get("x-real-ip")
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
    request.headers.get("x-real-ip")
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
