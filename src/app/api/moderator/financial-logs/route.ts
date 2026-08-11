// GET /api/moderator/financial-logs — paginated, filterable financial transaction log
// Auth: requireModerator
// Errors: 400, 401, 403
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { buildTxLogFilter, queryTxLog } from "@/lib/financialTxLog/queryLogs";
import type { GameState } from "@/lib/db/types";

export async function GET(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const built = buildTxLogFilter(searchParams);
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });

    const db = await getDb();
    const [result, gameState] = await Promise.all([
      queryTxLog(db, built.filter, built.limit),
      db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
    ]);
    return NextResponse.json({ ...result, currentTurn: gameState?.currentTurn ?? 0 });
  } catch (error) {
    return handleRouteError(error);
  }
}
