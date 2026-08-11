import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { GameState } from "@/lib/db/types";

const bodySchema = z.object({ enabled: z.boolean() });

// POST /api/admin/stats/toggle — enable/disable the RPG stat system. Admin only.
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
      rpgStatsEnabled: parsed.data.enabled,
      updatedAt: new Date(),
    };
    if (parsed.data.enabled) {
      set.rpgStatsEnabledBy = auth.admin.username;
      set.rpgStatsEnabledAt = now;
    }

    await db
      .collection<GameState>("gameState")
      .updateOne(
        { _id: "current" },
        parsed.data.enabled
          ? { $set: set }
          : { $set: set, $unset: { rpgStatsEnabledBy: "", rpgStatsEnabledAt: "" } }
      );

    return NextResponse.json({ success: true, rpgStatsEnabled: parsed.data.enabled });
  } catch (error) {
    return handleRouteError(error);
  }
}
