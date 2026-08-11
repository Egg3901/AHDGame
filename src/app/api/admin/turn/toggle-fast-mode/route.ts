import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { toggleFastMode } from "@/lib/turnSystem";

// POST /api/admin/turn/toggle-fast-mode — Toggles fast mode (30-minute turn cycles).
// Auth: requireAdmin
// Errors: 401, 403
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const result = await toggleFastMode();

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      fastMode: result.fastMode,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
