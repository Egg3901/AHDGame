import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { processTurn } from "@/lib/turnSystem";

// POST /api/admin/turn/process — Manually triggers a single game turn and returns the result with timing.
// Auth: requireAdmin
// Errors: 403
export async function POST() {
  try {
    // Verify admin authentication
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const start = performance.now();
    const result = await processTurn();
    const durationSeconds = Math.round((performance.now() - start) / 100) / 10;

    // Critical failure: turn didn't advance at all
    if (result.turn === 0) {
      return NextResponse.json({ error: result.message }, { status: 500 });
    }

    // Turn processed (possibly with phase warnings)
    return NextResponse.json({
      success: true,
      turn: result.turn,
      message: result.message,
      durationSeconds,
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
