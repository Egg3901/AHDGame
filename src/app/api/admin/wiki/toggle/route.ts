import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getGameStateCollection } from "@/lib/db/collections";

// POST /api/admin/wiki/toggle — Toggles wiki visibility for non-admin users.
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

    const newValue = !(gameState.wikiDisabled ?? false);

    await col.updateOne(
      { _id: "current" },
      { $set: { wikiDisabled: newValue, updatedAt: new Date() } }
    );

    return NextResponse.json({
      success: true,
      wikiDisabled: newValue,
      message: newValue
        ? "Wiki disabled — non-admin users will be redirected away from wiki pages"
        : "Wiki enabled — all users can access wiki pages",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET /api/admin/wiki/toggle — Returns current wiki disabled state.
// Auth: requireAdmin (used by WikiManagementTab client component)
// Errors: 401, 403, 404
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const col = await getGameStateCollection(db);
    const gameState = await col.findOne({ _id: "current" });

    if (!gameState) {
      return NextResponse.json({ error: "Game state not initialized" }, { status: 404 });
    }

    return NextResponse.json({ wikiDisabled: gameState.wikiDisabled ?? false });
  } catch (error) {
    return handleRouteError(error);
  }
}
