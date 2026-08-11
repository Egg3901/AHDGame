import { getWorldEntityOrThrow } from "@/lib/world/worldEntityManifest";
import { membershipFromManifestEntry, assertValidSphereMembership } from "./relationships";
import type { SphereMembership } from "./types";

/**
 * Austria 1953 occupation-era sphere posture.
 *
 * Soft Western lean with the US as the single primary sphere (Marshall Plan /
 * Western occupation influence). UK and USSR remain secondary relationships —
 * meaningful but without the full market package. DDR is non-sponsoring in
 * the preset matrix (#3718) and is intentionally absent from Austria's ties.
 */
export function getAustria1953SphereMembership(): SphereMembership {
  const entry = getWorldEntityOrThrow("1953-default", "AT");
  const membership = membershipFromManifestEntry(entry);
  assertValidSphereMembership(membership);
  return membership;
}
