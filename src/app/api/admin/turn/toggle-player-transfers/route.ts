import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getGameStateCollection } from "@/lib/db/collections";

// POST /api/admin/turn/toggle-player-transfers - Toggles player-to-player transfer blocking on/off.
// Auth: requireAdmin
// Errors: 403, 404
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const col = await getGameStateCollection(db);
    const gameState = await col.findOne({ _id: "current" });

    if (!gameState) {
      return NextResponse.json({ error: "Game state not initialized" }, { status: 404 });
    }

    const newValue = !(gameState.playerTransfersPaused ?? false);

    await col.updateOne(
      { _id: "current" },
      { $set: { playerTransfersPaused: newValue, updatedAt: new Date() } }
    );

    return NextResponse.json({
      success: true,
      playerTransfersPaused: newValue,
      message: newValue
        ? "Player-to-player transfers paused - direct character and party transfers will be blocked"
        : "Player-to-player transfers resumed - direct character and party transfers will run normally",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
