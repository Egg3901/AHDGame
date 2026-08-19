import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import type { GameConfig } from "@/lib/db/types";

const patchSchema = z.object({ enabled: z.boolean() });

// GET /api/admin/registration — fetch the master registration toggle state
// Auth: requireModerator (admin or moderator)
// Errors: 403
export async function GET() {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          registrationEnabled: 1,
          registrationDisabledBy: 1,
          registrationDisabledAt: 1,
        },
      }
    );

    // undefined is treated as "open" for legacy configs.
    const enabled = config?.registrationEnabled !== false;
    return NextResponse.json({
      enabled,
      disabledBy: config?.registrationDisabledBy ?? "",
      disabledAt: config?.registrationDisabledAt ?? "",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/registration — toggle master player registration
// Auth: requireModerator (admin or moderator)
// Errors: 400, 403
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
          $set: { registrationEnabled: true },
          $unset: { registrationDisabledBy: "", registrationDisabledAt: "" },
        },
        { upsert: true }
      );
    } else {
      await db.collection<GameConfig>("gameConfig").updateOne(
        { _id: "default" },
        {
          $set: {
            registrationEnabled: false,
            registrationDisabledBy: actor,
            registrationDisabledAt: now,
          },
        },
        { upsert: true }
      );
    }

    await createAdminLog({
      category: "system",
      action: enabled ? "registration_enabled" : "registration_disabled",
      username: actor,
      adminUsername: actor,
      details: enabled
        ? "Player registration re-opened"
        : "Player registration closed — all new-user paths blocked",
    });

    return NextResponse.json({ success: true, enabled });
  } catch (error) {
    return handleRouteError(error);
  }
}
