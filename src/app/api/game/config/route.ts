import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";
import { toPublicGameConfig } from "@/lib/gameConfig/publicGameConfig";

// GET /api/game/config — Returns the public game configuration including starting stats and tunable constants.
// Auth: public
// Errors: 404
export async function GET() {
  try {
    const db = await getDb();
    const config = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });

    if (!config) {
      return NextResponse.json(
        { error: "Game config not found. Run npm run seed first." },
        { status: 404 }
      );
    }

    return NextResponse.json(toPublicGameConfig(config), {
      headers: {
        // cache policy: reference — game config changes only on deploy/admin update; long CDN cache OK
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400, no-transform",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
