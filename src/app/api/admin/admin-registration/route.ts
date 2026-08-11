import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import type { GameConfig } from "@/lib/db/types";

const patchSchema = z.object({
  enabled: z.boolean(),
});

/** GET — fetch current admin-registration flag (admin only) */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          adminRegistrationEnabled: 1,
          adminRegistrationDisabledBy: 1,
          adminRegistrationDisabledAt: 1,
        },
      }
    );

    const hasSecret = !!process.env.ADMIN_REGISTRATION_KEY;
    // undefined is treated as enabled for legacy configs
    const enabled = config?.adminRegistrationEnabled !== false;

    return NextResponse.json({
      enabled,
      disabledBy: config?.adminRegistrationDisabledBy ?? "",
      disabledAt: config?.adminRegistrationDisabledAt ?? "",
      hasSecret,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** PATCH — toggle admin registration on/off */
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { enabled } = parsed.data;

    if (enabled && !process.env.ADMIN_REGISTRATION_KEY) {
      return NextResponse.json(
        {
          error:
            "Cannot enable admin registration: ADMIN_REGISTRATION_KEY environment variable is not set.",
        },
        { status: 400 }
      );
    }

    const db = await getDb();
    const now = new Date().toISOString();

    if (enabled) {
      await db.collection<GameConfig>("gameConfig").updateOne(
        { _id: "default" },
        {
          $set: { adminRegistrationEnabled: true },
          $unset: {
            adminRegistrationDisabledBy: "",
            adminRegistrationDisabledAt: "",
          },
        },
        { upsert: true }
      );
    } else {
      await db.collection<GameConfig>("gameConfig").updateOne(
        { _id: "default" },
        {
          $set: {
            adminRegistrationEnabled: false,
            adminRegistrationDisabledBy: auth.admin.username,
            adminRegistrationDisabledAt: now,
          },
        },
        { upsert: true }
      );
    }

    await createAdminLog({
      category: "system",
      action: enabled ? "admin_registration_enabled" : "admin_registration_disabled",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: enabled
        ? "Admin registration re-enabled — ADMIN_REGISTRATION_KEY now accepted"
        : "Admin registration disabled — admin key will be rejected",
    });

    return NextResponse.json({ success: true, enabled });
  } catch (error) {
    return handleRouteError(error);
  }
}
