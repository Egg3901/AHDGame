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

// GET /api/admin/config/regional-conditions-overview
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { regionalConditionsOverviewEnabled: 1 } });

    return NextResponse.json({
      enabled: config?.regionalConditionsOverviewEnabled === true,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/config/regional-conditions-overview
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { enabled } = parsed.data;
    const now = new Date().toISOString();
    const db = await getDb();

    await db.collection<GameConfig>("gameConfig").updateOne(
      { _id: "default" },
      {
        $set: {
          regionalConditionsOverviewEnabled: enabled,
          regionalConditionsOverviewEnabledBy: auth.admin.username,
          regionalConditionsOverviewEnabledAt: now,
        },
      },
      { upsert: true }
    );

    await createAdminLog({
      category: "system",
      action: enabled
        ? "regional_conditions_overview_enabled"
        : "regional_conditions_overview_disabled",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: enabled
        ? "Regional conditions card enabled on the state overview tab."
        : "Regional conditions card hidden from the state overview tab.",
    });

    return NextResponse.json({ success: true, enabled });
  } catch (error) {
    return handleRouteError(error);
  }
}
