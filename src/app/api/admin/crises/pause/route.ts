import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { GameState } from "@/lib/db/types";

const bodySchema = z.object({ paused: z.boolean() });

/**
 * POST /api/admin/crises/pause
 * Temporarily pause (or resume) automatic crisis/disaster spawning without
 * disabling the system. Existing crises keep running; no new ones spawn while
 * paused.
 * Auth: requireAdmin
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    await db
      .collection<GameState>("gameState")
      .updateOne(
        { _id: "current" },
        { $set: { autoCrisisPaused: parsed.data.paused, updatedAt: new Date() } }
      );

    return NextResponse.json({ success: true, autoCrisisPaused: parsed.data.paused });
  } catch (error) {
    return handleRouteError(error);
  }
}
