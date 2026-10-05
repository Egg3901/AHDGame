// POST /api/global-alerts/[id]/dismiss — Dismiss a global alert for the current user.
// Auth: requireAuth.
// Errors: 400 (invalid id), 401, 404 (no such alert).

import { errorResponse } from "@/lib/api/errors";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { isHexObjectIdString } from "@/lib/utils/objectIdHex";
import type { GlobalAlert } from "@/lib/db/types/globalAlert";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, { params }: RouteParams) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isHexObjectIdString(id)) {
    return errorResponse(400, "Invalid alert id");
  }

  const db = await getDb();
  const userId = new ObjectId(auth.user.userId);
  const result = await db
    .collection<GlobalAlert>("globalAlerts")
    .updateOne({ _id: new ObjectId(id) }, { $addToSet: { dismissedByUserIds: userId } });
  if (result.matchedCount === 0) {
    return errorResponse(404, "Alert not found");
  }
  return NextResponse.json({ ok: true });
}
