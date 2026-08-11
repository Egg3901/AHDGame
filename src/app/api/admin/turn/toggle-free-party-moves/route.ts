import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getGameStateCollection } from "@/lib/db/collections";

// POST /api/admin/turn/toggle-free-party-moves - Toggles the one-free-party-move launch window.
// When open, each player may make a single cooldown-free party switch (see the party join route).
// Flip on while staging a launch so players can settle into a party during the pause, off at go-live.
// Auth: requireAdmin
// Errors: 401, 403, 404
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

    const newValue = !(gameState.freePartyMovesOpen ?? false);

    await col.updateOne(
      { _id: "current" },
      { $set: { freePartyMovesOpen: newValue, updatedAt: new Date() } }
    );

    return NextResponse.json({
      success: true,
      freePartyMovesOpen: newValue,
      message: newValue
        ? "Free party moves open - each player gets one cooldown-free party switch during this window"
        : "Free party moves closed - the 24h party-switch cooldown applies normally",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
