import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

/**
 * Guards against Server-Side Request Forgery (SSRF) by blocking requests to
 * private, reserved, or link-local IP addresses. Used by the image proxy to
 * stop user-supplied URLs from reaching internal infrastructure (cloud metadata
 * 169.254.169.254, RFC1918 ranges, loopback).
 *
 * Self-contained — only Node built-ins `node:dns` and `node:net` — so the
 * classifier is pure and unit-testable. IPv4 handling is exhaustive; IPv6 is
 * best-effort against the common loopback/ULA/link-local/IPv4-mapped forms
 * (the URL path normalizes IPv6 to canonical compressed form before checking).
 */

/**
 * Converts an IPv4 dotted-quad to a 32-bit unsigned integer, or null if
 * malformed (octet out of range or non-numeric).
 */
function ipv4ToInt(ip: string): number | null {
  const octets = ip.split(".");
  if (octets.length !== 4) return null;
  let result = 0;
  for (const octet of octets) {
    const num = parseInt(octet, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8) | num;
  }
  return result >>> 0; // ensure unsigned
}

/** True if the 32-bit integer IP falls within baseOctets/maskBits. */
function inCidr(ipInt: number, baseOctets: number[], maskBits: number): boolean {
  if (maskBits < 0 || maskBits > 32) return false;
  const mask = maskBits === 0 ? 0 : ~((1 << (32 - maskBits)) - 1) >>> 0;
  const baseInt =
    ((baseOctets[0] << 24) | (baseOctets[1] << 16) | (baseOctets[2] << 8) | baseOctets[3]) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/**
 * Returns true if the IP is private, reserved, or otherwise unsafe to fetch.
 * Fail-closed: returns true for malformed or unrecognized input.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) {
    // Not a valid IP — treat as unsafe.
    return true;
  }

  if (family === 4) {
    const ipInt = ipv4ToInt(ip);
    if (ipInt === null) {
      return true;
    }

    const blockedRanges: [number[], number][] = [
      [[0, 0, 0, 0], 8], // 0.0.0.0/8 — this host
      [[10, 0, 0, 0], 8], // 10.0.0.0/8 — private
      [[100, 64, 0, 0], 10], // 100.64.0.0/10 — CGNAT
      [[127, 0, 0, 0], 8], // 127.0.0.0/8 — loopback
      [[169, 254, 0, 0], 16], // 169.254.0.0/16 — link-local (cloud metadata)
      [[172, 16, 0, 0], 12], // 172.16.0.0/12 — private
      [[192, 0, 0, 0], 24], // 192.0.0.0/24 — IETF protocol assignments
      [[192, 168, 0, 0], 16], // 192.168.0.0/16 — private
      [[198, 18, 0, 0], 15], // 198.18.0.0/15 — benchmarking
      [[224, 0, 0, 0], 4], // 224.0.0.0/4 — multicast
      [[240, 0, 0, 0], 4], // 240.0.0.0/4 — reserved (incl. broadcast)
    ];

    for (const [base, bits] of blockedRanges) {
      if (inCidr(ipInt, base, bits)) {
        return true;
      }
    }
    return false;
  }

  // family === 6
  const lowerIp = ip.toLowerCase();

  if (lowerIp === "::1" || lowerIp === "::") {
    return true;
  }

  // Unique-local fc00::/7
  if (lowerIp.startsWith("fc") || lowerIp.startsWith("fd")) {
    return true;
  }

  // Link-local fe80::/10
  if (
    lowerIp.startsWith("fe8") ||
    lowerIp.startsWith("fe9") ||
    lowerIp.startsWith("fea") ||
    lowerIp.startsWith("feb")
  ) {
    return true;
  }

  // IPv4-mapped / embedded (::ffff:a.b.c.d or ::ffff:HHHH:HHHH) — extract and recurse.
  const ipv4MappedPrefix = "::ffff:";
  const ipv4MappedIndex = lowerIp.indexOf(ipv4MappedPrefix);
  if (ipv4MappedIndex !== -1) {
    const afterPrefix = lowerIp.substring(ipv4MappedIndex + ipv4MappedPrefix.length);
    if (afterPrefix.includes(".")) {
      const parts = afterPrefix.split(":");
      const lastPart = parts[parts.length - 1];
      if (lastPart && isIP(lastPart) === 4) {
        return isPrivateOrReservedIp(lastPart);
      }
    } else {
      const hexGroups = afterPrefix.split(":");
      if (hexGroups.length === 2) {
        const high = parseInt(hexGroups[0], 16);
        const low = parseInt(hexGroups[1], 16);
        if (!isNaN(high) && !isNaN(low)) {
          const octets = [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
          return isPrivateOrReservedIp(octets.join("."));
        }
      }
    }
  }

  return false;
}

/**
 * Returns true only if rawUrl is http(s) and every resolved address is public.
 * Fail-closed: returns false on any error, non-http(s) scheme, or empty DNS.
 */
export async function isUrlSafeToFetch(rawUrl: string): Promise<boolean> {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    let hostname = url.hostname;
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      hostname = hostname.slice(1, -1);
    }

    if (isIP(hostname) !== 0) {
      return !isPrivateOrReservedIp(hostname);
    }

    const addrs = await lookup(hostname, { all: true });
    if (!addrs || addrs.length === 0) {
      return false;
    }

    return addrs.every((addr) => !isPrivateOrReservedIp(addr.address));
  } catch {
    return false;
  }
}
