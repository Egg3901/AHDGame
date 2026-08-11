/**
 * User-agent device classification.
 *
 * Coarse buckets — `mobile` / `tablet` / `desktop` — used by the registration
 * gate to relax shared-IP blocks on mobile carriers (cgNAT) and by the admin
 * panel to surface a cgNAT warning on shared-IP duplicate groups.
 *
 * Spoofable on its own; never used as the sole signal for moderation
 * decisions. Cross-reference with fingerprint and device key before acting.
 */
export type DeviceClass = "mobile" | "tablet" | "desktop";

export function classifyDevice(userAgent: string | null | undefined): DeviceClass {
  if (!userAgent) return "desktop";
  const ua = userAgent.toLowerCase();
  if (ua.includes("ipad") || ua.includes("tablet")) return "tablet";
  // Android phones include "Mobile" in their UA, Android tablets do not — so
  // the "mobile" check captures phones without misclassifying tablets.
  if (ua.includes("mobile") || ua.includes("iphone")) return "mobile";
  return "desktop";
}

/** True for any device that typically sits behind carrier NAT / cgNAT. */
export function isCgnatProneDevice(device: DeviceClass): boolean {
  return device === "mobile" || device === "tablet";
}
