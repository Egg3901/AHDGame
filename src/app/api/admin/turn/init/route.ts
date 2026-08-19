import { NextResponse } from "next/server";
import { initializeCronJobs } from "@/lib/cron";
import { initializeGameState } from "@/lib/turnSystem";
import { handleRouteError } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/api/requireAdmin";

// POST /api/admin/turn/init — Initializes the game state and cron jobs for the turn system.
// Auth: requireAdmin
// Errors: 403
// This endpoint initializes the cron jobs and game state
// Call this when the server starts or from admin panel
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    // Initialize game state
    await initializeGameState();

    // Initialize cron jobs
    await initializeCronJobs();

    return NextResponse.json({
      success: true,
      message: "Turn system initialized successfully",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET /api/admin/turn/init — Checks and initializes game state, returning the current turn and active status.
// Auth: requireAdmin
// Errors: 403
// Also allow GET for easy server initialization check
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const gameState = await initializeGameState();

    return NextResponse.json({
      success: true,
      initialized: true,
      currentTurn: gameState.currentTurn,
      isActive: gameState.isActive,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
