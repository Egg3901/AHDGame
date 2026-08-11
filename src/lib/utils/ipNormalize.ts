const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_MAPPED_IPV4_REGEX = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

function isValidIpv4Octets(a: string, b: string, c: string, d: string): boolean {
  return [a, b, c, d].every((o) => {
    const n = Number(o);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

/**
 * Normalize a user-supplied or header-derived IP string.
 * Returns a normalized form or `null` for "unknown" / empty / unparseable values.
 * - Trims whitespace.
 * - Lowercases the string (no-op for IPv4; correctness-preserving for IPv6).
 * - Collapses IPv4-mapped IPv6 (`::ffff:a.b.c.d`) to bare IPv4.
 */
export function normalizeIp(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") return null;

  const mapped = trimmed.match(IPV6_MAPPED_IPV4_REGEX);
  if (mapped) {
    const candidate = mapped[1];
    const parts = candidate.split(".");
    return isValidIpv4Octets(parts[0], parts[1], parts[2], parts[3]) ? candidate : null;
  }

  const ipv4 = trimmed.match(IPV4_REGEX);
  if (ipv4) {
    return isValidIpv4Octets(ipv4[1], ipv4[2], ipv4[3], ipv4[4]) ? trimmed : null;
  }

  // IPv6: accept anything containing a colon and only hex / `::` / `:` characters.
  if (/^[0-9a-f:]+$/i.test(trimmed) && trimmed.includes(":")) {
    return trimmed.toLowerCase();
  }

  return null;
}

/**
 * Build a small set of exact-match variants for legacy `registrationIp`
 * rows so collision checks still work after we standardized new writes.
 *
 * WHY: Older accounts may have been stored as `::ffff:a.b.c.d` while new
 * registrations now normalize to bare IPv4. The collision gate must treat
 * those as the same source location or the admin toggle looks enabled but
 * fails to block repeat registrations.
 */
export function getRegistrationIpMatchCandidates(raw: string): string[] {
  const normalized = normalizeIp(raw);
  if (!normalized) return [];

  const trimmed = raw.trim();
  const variants = new Set<string>([normalized]);

  if (trimmed) {
    variants.add(trimmed);
    variants.add(trimmed.toLowerCase());
  }

  if (IPV4_REGEX.test(normalized)) {
    variants.add(`::ffff:${normalized}`);
    variants.add(`::FFFF:${normalized}`);
  }

  return [...variants];
}
