import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { GameState } from "@/lib/db/types";

// GET /api/admin/conflicts/cold-war/toggle - Read the Cold War subsystem flag.
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameState = await db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          coldWarEnabled: 1,
          coldWarEnabledBy: 1,
          coldWarEnabledAt: 1,
        },
      }
    );
    return NextResponse.json({
      enabled: gameState?.coldWarEnabled ?? false,
      enabledBy: gameState?.coldWarEnabledBy,
      enabledAt: gameState?.coldWarEnabledAt,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/admin/conflicts/cold-war/toggle - Refused: this legacy flag is retired.
// The live conflict system uses conflictsEnabled as its single master gate.
// Auth: requireAdmin
// Errors: 403, 409
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    return NextResponse.json(
      {
        error:
          "The legacy coldWarEnabled flag is retired. Use conflictsEnabled for the live conflict system.",
      },
      { status: 409 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
