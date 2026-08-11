// Shared helpers for the alt-detection read/config REST API
// (forensics/alt-detection rework plan §4.9, Phase 6 T6.2). Not a route
// itself — Next.js only treats `route.ts`/`page.ts` files as handlers, so
// this file is safe to colocate under `src/app/api/admin/alts/`.
//
// Role gating doctrine (plan §4.6): both moderators and admins can read
// ranked clusters/links/confidence/per-signal breakdown and evidence.
// Only admins may edit the scoring config or see un-redacted evidence
// strings that still carry a masked-but-informative fingerprint/IP
// fragment (`maskFingerprint`/`maskIp` in `src/lib/altDetection/signals.ts`
// already strip the raw value at write time — this is a *second*, stricter
// redaction pass for the moderator view only).

import type { ObjectId } from "mongodb";
import type { AltSignal } from "@/lib/db/types/altDetection";
import { DEFAULT_ALT_SCORING_WEIGHTS } from "@/lib/altDetection/config";

/** Every valid signal type, derived from the weight table so this list can
 * never drift from the registry. */
export const ALL_ALT_SIGNALS: ReadonlySet<string> = new Set(
  Object.keys(DEFAULT_ALT_SCORING_WEIGHTS)
);

export function isAltSignal(value: string): value is AltSignal {
  return ALL_ALT_SIGNALS.has(value);
}

// Evidence redaction lives in src/lib (domain logic, not route-file-only) —
// re-exported here so the existing route consumers in this directory don't
// need their own import path change.
export {
  redactEvidenceForModerator,
  redactEvidenceForRole,
} from "@/lib/altDetection/evidenceRedaction";

/** Cursor for the confidence-desc ranked cluster list: `{confidence}_{id}`,
 * base64url-encoded, paired with a compound `{confidence:-1,_id:-1}` sort
 * (keyset pagination — stable even though `confidence` alone isn't unique). */
export interface ClusterCursor {
  confidence: number;
  id: string;
}

export function encodeClusterCursor(confidence: number, id: ObjectId): string {
  return Buffer.from(`${confidence}_${id.toHexString()}`, "utf8").toString("base64url");
}

export function decodeClusterCursor(cursor: string): ClusterCursor | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const idx = raw.lastIndexOf("_");
    if (idx <= 0) return null;
    const confidence = Number(raw.slice(0, idx));
    const id = raw.slice(idx + 1);
    if (!Number.isFinite(confidence) || !/^[0-9a-f]{24}$/i.test(id)) return null;
    return { confidence, id };
  } catch {
    return null;
  }
}

export { memberRole } from "@/lib/altDetection/evidenceRedaction";
