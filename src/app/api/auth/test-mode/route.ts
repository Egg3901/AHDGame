import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";

// GET /api/auth/test-mode — Returns whether test mode is currently active for the game.
// Auth: public
// Errors: (none)
/** GET — public endpoint returning whether test mode is active */
export async function GET() {
  try {
    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { testMode: 1 } });

    return NextResponse.json({ testMode: config?.testMode ?? false });
  } catch (error) {
    return handleRouteError(error);
  }
}
