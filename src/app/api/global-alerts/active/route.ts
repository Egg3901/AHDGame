// GET /api/global-alerts/active — Active (non-expired, non-dismissed) global alerts for the current user.
// Auth: requireAuth.

import { conditionalJson } from "@/lib/api/conditionalJson";
import { ObjectId } from "mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import type { GlobalAlert } from "@/lib/db/types/globalAlert";

export async function GET(request: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const db = await getDb();
  const userId = new ObjectId(auth.user.userId);
  const nowMs = Date.now();

  const alerts = await db
    .collection<GlobalAlert>("globalAlerts")
    .find({
      expiresAtRealtimeMs: { $gt: nowMs },
      dismissedByUserIds: { $ne: userId },
    })
    .sort({ emittedAtRealtimeMs: -1 })
    .limit(10)
    .toArray();

  // Per-user (filters out this user's dismissed alerts) — private ETag/304 only.
  return conditionalJson(request, {
    alerts: alerts.map((a) => ({
      id: a._id.toString(),
      kind: a.kind,
      countryCode: a.countryCode,
      insolventCorpCount: a.insolventCorpCount,
      emittedAtTurn: a.emittedAtTurn,
      emittedAtRealtimeMs: a.emittedAtRealtimeMs,
      expiresAtRealtimeMs: a.expiresAtRealtimeMs,
    })),
  });
}
