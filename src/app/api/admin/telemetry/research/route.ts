import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { exportResearchPanel } from "@/lib/telemetry/research/export";
import { parseResearchQuery } from "@/lib/telemetry/research/rules";

// GET /api/admin/telemetry/research?panel=country-turn|annual-fiscal|trade|securities
//   &fromTurn=&toTurn=&countries=US,UK&commodities=oil&limit=&after=
// Bounded, read-only research export (#2331, #2332, #2333, #2336). Rows are
// sanitized aggregates: no player records, no holder identities. Every request
// is capped by turn window and row count; follow `nextCursor` via `after`.
// Auth: requireAdmin
// Errors: 400, 403
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameState = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" as never }, { projection: { currentTurn: 1 } });
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const parsed = parseResearchQuery(params, gameState?.currentTurn ?? 0);
    if (!parsed.ok) return errorResponse(400, parsed.error);

    return NextResponse.json(await exportResearchPanel(db, parsed.query), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleRouteError(error, { route: "GET /api/admin/telemetry/research" });
  }
}
