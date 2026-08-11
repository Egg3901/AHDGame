import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryGameState } from "@/lib/publicApi/game";

// GET /api/public/v1/game
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "game");
    if (!guard.ok) return guard.response;

    const db = await getDb();
    const result = await queryGameState(db);

    if (!result) {
      return NextResponse.json(
        { ok: false, error: "Game state unavailable", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
