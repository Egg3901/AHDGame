import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { GameState } from "@/lib/db/types";

// GET /api/game-time — Return current game state (turn, year, iteration)
// Auth: public
// Errors: none (returns defaults if no game state exists)
export async function GET() {
  const db = await getDb();
  const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });

  return NextResponse.json({
    currentTurn: gameState?.currentTurn ?? 1,
    currentYear: gameState?.currentYear ?? 2020,
    isActive: gameState?.isActive ?? false,
    iteration: gameState?.iteration ?? null,
  });
}

const iterationSchema = z.object({
  iteration: z.object({
    type: z.enum(["Alpha", "Beta", "Iteration"]),
    number: z.number().int().min(1),
  }),
});

// PATCH /api/game-time — Update game iteration without resetting
// Auth: requireAdmin
// Errors: 400, 401, 403
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, iterationSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    // Maintain the global iteration registry alongside the current iteration so
    // generated wiki office pages always show every known iteration section.
    const current = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const { orderIterations } = await import("@/lib/wiki/officeIteration");
    const iterationHistory = orderIterations(current?.iterationHistory ?? [], [
      parsed.data.iteration,
    ]);
    await db
      .collection<GameState>("gameState")
      .updateOne(
        { _id: "current" },
        { $set: { iteration: parsed.data.iteration, iterationHistory, updatedAt: new Date() } },
        { upsert: true }
      );

    return NextResponse.json({
      success: true,
      iteration: parsed.data.iteration,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
