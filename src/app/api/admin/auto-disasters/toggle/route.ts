import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { GameState } from "@/lib/db/types";

const bodySchema = z.object({
  enabled: z.boolean(),
});

/**
 * POST /api/admin/auto-disasters/toggle
 * Flip the automatic natural-disaster system on/off. When off, the turn engine
 * skips the disaster phase entirely. When on, disasters fire per-country based
 * on lastDisasterTurn and configured probabilities.
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
    const now = new Date().toISOString();
    const set: Partial<GameState> = {
      autoDisastersEnabled: parsed.data.enabled,
      updatedAt: new Date(),
    };
    if (parsed.data.enabled) {
      set.autoDisastersEnabledBy = auth.admin.username;
      set.autoDisastersEnabledAt = now;
    }

    await db.collection<GameState>("gameState").updateOne(
      { _id: "current" },
      parsed.data.enabled
        ? { $set: set }
        : {
            $set: set,
            $unset: { autoDisastersEnabledBy: "", autoDisastersEnabledAt: "" },
          }
    );

    return NextResponse.json({
      success: true,
      autoDisastersEnabled: parsed.data.enabled,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
