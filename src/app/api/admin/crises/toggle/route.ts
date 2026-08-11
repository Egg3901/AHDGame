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
 * POST /api/admin/crises/toggle
 * Flip the crisis interaction system on/off (decision trees, templates,
 * collective contributions, ambient interaction cards). When off, only the
 * legacy manual crisis creator is available.
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
      crisisInteractionEnabled: parsed.data.enabled,
      updatedAt: new Date(),
    };
    if (parsed.data.enabled) {
      set.crisisInteractionEnabledBy = auth.admin.username;
      set.crisisInteractionEnabledAt = now;
    }

    await db.collection<GameState>("gameState").updateOne(
      { _id: "current" },
      parsed.data.enabled
        ? { $set: set }
        : {
            $set: set,
            $unset: { crisisInteractionEnabledBy: "", crisisInteractionEnabledAt: "" },
          }
    );

    return NextResponse.json({
      success: true,
      crisisInteractionEnabled: parsed.data.enabled,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
