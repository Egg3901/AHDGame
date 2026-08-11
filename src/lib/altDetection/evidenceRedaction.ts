// Evidence redaction + member-role helpers for the alt-detection read/config
// REST API (forensics/alt-detection rework plan §4.9, Phase 6 T6.2).
//
// Role gating doctrine (plan §4.6): both moderators and admins can read
// ranked clusters/links/confidence/per-signal breakdown and evidence.
// Only admins may edit the scoring config or see un-redacted evidence
// strings that still carry a masked-but-informative fingerprint/IP
// fragment (`maskFingerprint`/`maskIp` in `src/lib/altDetection/signals.ts`
// already strip the raw value at write time — this is a *second*, stricter
// redaction pass for the moderator view only).

import type { ObjectId } from "mongodb";

/** Matches the masked fingerprint fragment `maskFingerprint` embeds in
 * evidence strings (first <=8 chars + an ellipsis), e.g. `a1b2c3d4…`. */
const MASKED_FINGERPRINT_RE = /\b[0-9a-zA-Z]{6,8}…/g;

/** Matches the masked IPv4 fragment `maskIp` embeds in evidence strings,
 * e.g. `12.34.56.xxx`. */
const MASKED_IPV4_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.xxx\b/g;

/** Matches the masked IPv6 fragment `maskIp` embeds, e.g. `fe80:1::xxxx`. */
const MASKED_IPV6_RE = /\b[0-9a-f]{1,4}:[0-9a-f]{1,4}::xxxx\b/gi;

/**
 * Redact the residual masked fingerprint/IP fragments out of a stored
 * evidence string for the moderator view (plan §4.6: "raw fingerprint/full
 * IP — admin only"). Admins see the evidence string untouched. Everything
 * else in the string (signal description, counts, usernames — already
 * visible to moderators elsewhere, e.g. `/api/moderator/users`) is kept so
 * the evidence stays legible.
 */
export function redactEvidenceForModerator(evidence: string): string {
  return evidence
    .replace(MASKED_IPV6_RE, "[ip]")
    .replace(MASKED_IPV4_RE, "[ip]")
    .replace(MASKED_FINGERPRINT_RE, "[fingerprint]");
}

export function redactEvidenceForRole(evidence: string, isAdmin: boolean): string {
  return isAdmin ? evidence : redactEvidenceForModerator(evidence);
}

/** Member role within a cluster, derived from `AltCluster.roles`. */
export function memberRole(
  userIdStr: string,
  roles: { operator?: ObjectId; burners: ObjectId[]; associates: ObjectId[] }
): "operator" | "burner" | "associate" {
  if (roles.operator?.toString() === userIdStr) return "operator";
  if (roles.burners.some((id) => id.toString() === userIdStr)) return "burner";
  return "associate";
}
