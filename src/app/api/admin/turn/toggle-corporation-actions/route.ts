import { NextResponse } from "next/server";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getGameStateCollection } from "@/lib/db/collections";
import { createAdminLog } from "@/lib/adminLog";

// POST /api/admin/turn/toggle-corporation-actions — Toggles corporation action processing on/off.
// Auth: requireModerator (admin or moderator)
// Errors: 403, 404
export async function POST() {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const col = await getGameStateCollection(db);
    const gameState = await col.findOne({ _id: "current" });

    if (!gameState) {
      return NextResponse.json({ error: "Game state not initialized" }, { status: 404 });
    }

    const newValue = !(gameState.corporationActionsPaused ?? false);

    await col.updateOne(
      { _id: "current" },
      { $set: { corporationActionsPaused: newValue, updatedAt: new Date() } }
    );

    const message = newValue
      ? "Corporation actions paused — corporate phases will be skipped during turn processing"
      : "Corporation actions resumed — corporate phases will run normally";

    await createAdminLog({
      category: "system",
      action: newValue ? "corporation_actions_paused" : "corporation_actions_resumed",
      username: auth.user.username,
      adminUsername: auth.user.username,
      details: message,
    });

    return NextResponse.json({
      success: true,
      corporationActionsPaused: newValue,
      message,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
