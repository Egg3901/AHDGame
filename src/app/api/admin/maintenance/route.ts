import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import { invalidateMaintenanceCache, normalizeMaintenanceMode } from "@/lib/maintenanceStatus";
import type { GameConfig } from "@/lib/db/types";

const patchSchema = z.object({
  mode: z.enum(["off", "partial", "full"]),
  reason: z.string().max(500).optional(),
  expectedEnd: z.string().optional(),
});

// GET /api/admin/maintenance - Fetch the current tri-state maintenance status.
// Auth: requireAdmin
// Errors: 403
/** GET — fetch current maintenance status (admin only) */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          maintenanceMode: 1,
          maintenanceReason: 1,
          maintenanceExpectedEnd: 1,
          maintenanceEnabledBy: 1,
          maintenanceEnabledAt: 1,
        },
      }
    );

    const mode = normalizeMaintenanceMode(config?.maintenanceMode);
    return NextResponse.json({
      mode,
      enabled: mode !== "off",
      reason: config?.maintenanceReason ?? "",
      expectedEnd: config?.maintenanceExpectedEnd ?? "",
      enabledBy: config?.maintenanceEnabledBy ?? "",
      enabledAt: config?.maintenanceEnabledAt ?? "",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/maintenance - Set maintenance mode to off/partial/full.
// Auth: requireAdmin
// Errors: 400, 403
/** PATCH — set the tri-state maintenance mode */
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { mode, reason, expectedEnd } = parsed.data;

    const db = await getDb();
    const now = new Date().toISOString();

    if (mode !== "off") {
      await db.collection<GameConfig>("gameConfig").updateOne(
        { _id: "default" },
        {
          $set: {
            maintenanceMode: mode,
            maintenanceReason: reason ?? "",
            maintenanceExpectedEnd: expectedEnd ?? "",
            maintenanceEnabledBy: auth.admin.username,
            maintenanceEnabledAt: now,
          },
        },
        { upsert: true }
      );
    } else {
      await db.collection<GameConfig>("gameConfig").updateOne(
        { _id: "default" },
        {
          $set: { maintenanceMode: "off" },
          $unset: {
            maintenanceReason: "",
            maintenanceExpectedEnd: "",
            maintenanceEnabledBy: "",
            maintenanceEnabledAt: "",
          },
        }
      );
    }

    // Drop the in-process cache so the new state is picked up on the next
    // request without waiting for the TTL to expire. Other server processes
    // still see stale state until their own TTL elapses.
    invalidateMaintenanceCache();

    await createAdminLog({
      category: "system",
      action: mode === "off" ? "maintenance_mode_disabled" : "maintenance_mode_set",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details:
        mode === "off"
          ? "Maintenance disabled"
          : `Maintenance mode set to "${mode}"${reason ? `: ${reason}` : ""}${expectedEnd ? ` (expected end: ${expectedEnd})` : ""}`,
    });

    return NextResponse.json({ success: true, mode, enabled: mode !== "off" });
  } catch (error) {
    return handleRouteError(error);
  }
}
