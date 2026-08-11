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

/** GET — fetch current test mode status (admin only) */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          testMode: 1,
          testModeEnabledBy: 1,
          testModeEnabledAt: 1,
        },
      }
    );

    const hasSecret = !!process.env.TEST_SECRET;

    return NextResponse.json({
      enabled: config?.testMode ?? false,
      enabledBy: config?.testModeEnabledBy ?? "",
      enabledAt: config?.testModeEnabledAt ?? "",
      hasSecret,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** PATCH — toggle test mode */
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { enabled } = parsed.data;

    // Require TEST_SECRET env var to enable test mode
    if (enabled && !process.env.TEST_SECRET) {
      return NextResponse.json(
        { error: "Cannot enable test mode: TEST_SECRET environment variable is not set." },
        { status: 400 }
      );
    }

    const db = await getDb();
    const now = new Date().toISOString();

    if (enabled) {
      await db.collection<GameConfig>("gameConfig").updateOne(
        { _id: "default" },
        {
          $set: {
            testMode: true,
            testModeEnabledBy: auth.admin.username,
            testModeEnabledAt: now,
          },
        },
        { upsert: true }
      );
    } else {
      await db.collection<GameConfig>("gameConfig").updateOne(
        { _id: "default" },
        {
          $set: { testMode: false },
          $unset: {
            testModeEnabledBy: "",
            testModeEnabledAt: "",
          },
        }
      );
    }

    await createAdminLog({
      category: "system",
      action: enabled ? "test_mode_enabled" : "test_mode_disabled",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: enabled
        ? "Test mode enabled — registration now requires TEST_SECRET"
        : "Test mode disabled — registration open to all",
    });

    return NextResponse.json({ success: true, enabled });
  } catch (error) {
    return handleRouteError(error);
  }
}
