import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import type { GameConfig } from "@/lib/db/types";

const patchSchema = z.object({ enabled: z.boolean() });

// GET /api/admin/ip-collision-check — fetch the collision-check toggle state
// Auth: requireModerator (admin or moderator)
// Errors: 401, 403
export async function GET() {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          ipCollisionCheckEnabled: 1,
          ipCollisionCheckEnabledBy: 1,
          ipCollisionCheckEnabledAt: 1,
        },
      }
    );

    return NextResponse.json({
      enabled: config?.ipCollisionCheckEnabled === true,
      enabledBy: config?.ipCollisionCheckEnabledBy ?? "",
      enabledAt: config?.ipCollisionCheckEnabledAt ?? "",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/ip-collision-check — flip the collision-check toggle
// Auth: requireModerator (admin or moderator)
// Errors: 400, 401, 403
export async function PATCH(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { enabled } = parsed.data;
    const db = await getDb();
    const now = new Date().toISOString();
    const actor = auth.user.username;

    if (enabled) {
      await db.collection<GameConfig>("gameConfig").updateOne(
        { _id: "default" },
        {
          $set: {
            ipCollisionCheckEnabled: true,
            ipCollisionCheckEnabledBy: actor,
            ipCollisionCheckEnabledAt: now,
          },
        },
        { upsert: true }
      );
    } else {
      await db.collection<GameConfig>("gameConfig").updateOne(
        { _id: "default" },
        {
          $set: { ipCollisionCheckEnabled: false },
          $unset: { ipCollisionCheckEnabledBy: "", ipCollisionCheckEnabledAt: "" },
        },
        { upsert: true }
      );
    }

    await createAdminLog({
      category: "system",
      action: enabled ? "ip_collision_check_enabled" : "ip_collision_check_disabled",
      username: actor,
      adminUsername: actor,
      details: enabled
        ? "IP collision check ON — new registrations blocked on existing IPs, browser cookies, and exact fingerprints"
        : "IP collision check OFF — only manual IP bans apply",
    });

    return NextResponse.json({ success: true, enabled });
  } catch (error) {
    return handleRouteError(error);
  }
}
