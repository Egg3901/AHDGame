import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { GameState } from "@/lib/db/types";

const bodySchema = z.object({ enabled: z.boolean() });

/**
 * POST /api/admin/auto-sector-seed/toggle
 * Flip the automatic sector seeding system on/off. When on, the turn engine
 * applies a distress-weighted boost to unowned sector revenue every 48 turns.
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
      autoSectorSeedEnabled: parsed.data.enabled,
      updatedAt: new Date(),
    };
    if (parsed.data.enabled) {
      set.autoSectorSeedEnabledBy = auth.admin.username;
      set.autoSectorSeedEnabledAt = now;
    }

    await db
      .collection<GameState>("gameState")
      .updateOne(
        { _id: "current" },
        parsed.data.enabled
          ? { $set: set }
          : { $set: set, $unset: { autoSectorSeedEnabledBy: "", autoSectorSeedEnabledAt: "" } }
      );

    return NextResponse.json({
      success: true,
      autoSectorSeedEnabled: parsed.data.enabled,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
