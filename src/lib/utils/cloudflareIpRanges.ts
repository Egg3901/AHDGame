// Cloudflare's published edge IP ranges (https://www.cloudflare.com/ips/, checked 2026-07).
// Used as a defense-in-depth guard in alt-account detection: a login IP that
// falls inside Cloudflare's own edge range is never a real client IP — it can
// only get recorded that way from a proxy-header misconfiguration (the bug
// fixed in src/lib/utils/network.ts) or a future regression of the same kind.
// Excluding these from IP-based matching means any already-logged rows from
// before that fix stop producing false alt-account matches immediately,
// rather than waiting out the detectors' 7-14 day lookback windows.
//
// This list needs occasional refreshing against Cloudflare's published ranges
// as they add capacity; staleness only means the guard under-catches, it
// never causes a false exclusion of a real player's IP.

const CLOUDFLARE_IPV4_CIDRS = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

// IPv6 ranges, expressed as the leading hextet groups a matching address
// must start with (a coarse approximation of the real prefix length — exact
// bit-level masking isn't needed for a non-security-boundary heuristic).
const CLOUDFLARE_IPV6_PREFIXES = [
  "2400:cb00:",
  "2606:4700:",
  "2803:f800:",
  "2405:b500:",
  "2405:8100:",
  "2a06:98c",
  "2c0f:f248:",
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = (result << 8) | octet;
  }
  return result >>> 0;
}

const PARSED_CIDRS = CLOUDFLARE_IPV4_CIDRS.map((cidr) => {
  const [base, bits] = cidr.split("/");
  const prefixLength = Number(bits);
  const baseInt = ipv4ToInt(base)!;
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return { base: baseInt & mask, mask };
});

/** True if `ip` falls inside a published Cloudflare edge range (IPv4 or IPv6). */
export function isCloudflareEdgeIp(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return CLOUDFLARE_IPV6_PREFIXES.some((prefix) => lower.startsWith(prefix));
  }

  const asInt = ipv4ToInt(ip);
  if (asInt === null) return false;
  return PARSED_CIDRS.some(({ base, mask }) => (asInt & mask) === base);
}
