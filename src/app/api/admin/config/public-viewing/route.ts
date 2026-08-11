import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import { invalidatePublicViewingCache } from "@/lib/publicViewing";
import type { GameConfig } from "@/lib/db/types";

const patchSchema = z.object({
  enabled: z.boolean(),
});

// GET /api/admin/config/public-viewing — current public viewing mode (API read-gate)
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          publicViewingMode: 1,
          publicViewingModeUpdatedBy: 1,
          publicViewingModeUpdatedAt: 1,
        },
      }
    );

    return NextResponse.json({
      // Default ON: absent/undefined => enabled; only explicit false locks reads.
      enabled: config?.publicViewingMode !== false,
      updatedBy: config?.publicViewingModeUpdatedBy ?? "",
      updatedAt: config?.publicViewingModeUpdatedAt ?? "",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/config/public-viewing — toggle anonymous API read access
// Auth: requireAdmin
// Errors: 400, 403
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { enabled } = parsed.data;

    const db = await getDb();
    await db.collection<GameConfig>("gameConfig").updateOne(
      { _id: "default" },
      {
        $set: {
          publicViewingMode: enabled,
          publicViewingModeUpdatedBy: auth.admin.username,
          publicViewingModeUpdatedAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );

    // Drop the in-process cache so the new state is picked up on the next
    // request without waiting for the TTL. Other server processes still see
    // stale state until their own TTL elapses.
    invalidatePublicViewingCache();

    await createAdminLog({
      category: "system",
      action: enabled ? "public_viewing_enabled" : "public_viewing_disabled",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: enabled
        ? "Public viewing enabled — anonymous visitors can read internal API content."
        : "Public viewing disabled — internal API reads require an authenticated session.",
    });

    return NextResponse.json({ success: true, enabled });
  } catch (error) {
    return handleRouteError(error);
  }
}
