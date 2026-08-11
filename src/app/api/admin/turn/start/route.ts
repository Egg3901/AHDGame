import { NextResponse } from "next/server";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { startTurnSystem } from "@/lib/turnSystem";
import { createAdminLog } from "@/lib/adminLog";

// POST /api/admin/turn/start — Starts the turn system so it processes turns on the hourly cron schedule.
// Auth: requireModerator (admin or moderator)
// Errors: 401, 403
export async function POST() {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const result = await startTurnSystem();

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 500 });
    }

    await createAdminLog({
      category: "system",
      action: "turn_system_started",
      username: auth.user.username,
      adminUsername: auth.user.username,
      details: result.message,
    });

    return NextResponse.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
