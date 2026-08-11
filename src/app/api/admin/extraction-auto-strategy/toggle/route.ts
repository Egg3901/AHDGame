import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { GameState } from "@/lib/db/types";

const bodySchema = z.object({ enabled: z.boolean() });

/**
 * POST /api/admin/extraction-auto-strategy/toggle
 * Flip extraction auto strategy adoption (remediation Phase 1a) on/off. When on,
 * the turn engine nudges standard miners on shortage deposits with per-state
 * headroom onto the matching focused mining strategy (self-limiting, gradual).
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
      extractionAutoStrategyEnabled: parsed.data.enabled,
      updatedAt: new Date(),
    };
    if (parsed.data.enabled) {
      set.extractionAutoStrategyEnabledBy = auth.admin.username;
      set.extractionAutoStrategyEnabledAt = now;
    }

    await db.collection<GameState>("gameState").updateOne(
      { _id: "current" },
      parsed.data.enabled
        ? { $set: set }
        : {
            $set: set,
            $unset: { extractionAutoStrategyEnabledBy: "", extractionAutoStrategyEnabledAt: "" },
          }
    );

    return NextResponse.json({
      success: true,
      extractionAutoStrategyEnabled: parsed.data.enabled,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
