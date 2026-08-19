// GET /api/admin/inflation
// Returns per-country inflation diagnostics: stored rate, recomputed rate +
// signed contribution of every driver, plus the raw inputs that went into
// each calculation. Lets an admin see exactly which channel is dominating
// when inflation hits the floor.
// Auth: requireAdmin
// Errors: 403

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { loadInflationDiagnostics } from "@/lib/monetaryPolicy/queries/inflationDiagnostics";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameState = await getGameState(db);
    const currentTurn = gameState?.currentTurn ?? 0;

    const payload = await loadInflationDiagnostics(db, currentTurn);
    return NextResponse.json(payload);
  } catch (error) {
    return handleRouteError(error);
  }
}
