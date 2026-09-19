import type { IdentityTrack } from "@/lib/db/types/identityObservation";
import { isCloudflareEdgeIp } from "@/lib/utils/cloudflareIpRanges";
import { isDegenerateFingerprint } from "@/lib/utils/degenerateFingerprints";

/** IP values that are placeholders rather than addresses. Mirrors SENTINEL_IPS
 * in src/lib/auth/identitySignals.ts, which is not exported. Keep in sync. */
const SENTINEL_IPS: ReadonlySet<string> = new Set(["unknown", "::1", "127.0.0.1"]);

/**
 * True when a value is real evidence and may be stored as a run.
 *
 * Filtering at WRITE time means `identityObservations` never holds a sentinel,
 * so no downstream reader can forget the check. `duplicateGroups.ts` carries an
 * explicit warning about this exact failure: an unresolvable IP that reaches
 * grouping welds every affected account into one component.
 */
export function isGroupableIdentityValue(
  track: IdentityTrack,
  value: string | null | undefined
): value is string {
  if (!value) return false;
  if (track === "ip") {
    if (SENTINEL_IPS.has(value)) return false;
    return !isCloudflareEdgeIp(value);
  }
  return !isDegenerateFingerprint(value);
}
