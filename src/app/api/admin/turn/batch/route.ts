import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { processTurn } from "@/lib/turnSystem";
import { parseJsonBody } from "@/lib/api/validate";
import { adminTurnBatchSchema } from "@/lib/api/schemas/admin";

// POST /api/admin/turn/batch — Processes multiple game turns in sequence and returns per-turn results.
// Auth: requireAdmin
// Errors: 400, 403
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, adminTurnBatchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { count } = parsed.data;

    const results: { turn: number; message: string; warnings?: string[] }[] = [];
    const start = performance.now();

    for (let i = 0; i < count; i++) {
      const result = await processTurn();
      if (result.turn === 0) {
        // Critical failure — turn didn't advance at all
        return NextResponse.json(
          {
            error: `Turn ${i + 1} failed: ${result.message}`,
            completed: i,
            results,
          },
          { status: 500 }
        );
      }
      results.push({
        turn: result.turn,
        message: result.message,
        ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
      });
    }

    const durationSeconds = Math.round((performance.now() - start) / 100) / 10;

    return NextResponse.json({
      success: true,
      completed: count,
      finalTurn: results[results.length - 1]?.turn,
      message: `Successfully processed ${count} turn${count !== 1 ? "s" : ""}.`,
      durationSeconds,
      results,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
