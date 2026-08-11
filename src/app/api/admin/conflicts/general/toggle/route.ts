import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { GameState } from "@/lib/db/types";

const bodySchema = z.object({ enabled: z.boolean() });

// GET /api/admin/conflicts/general/toggle - Read the Conflicts subsystem flag.
// Auth: requireAdmin
// Errors: 401
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameState = await db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          conflictsEnabled: 1,
          conflictsEnabledBy: 1,
          conflictsEnabledAt: 1,
        },
      }
    );
    return NextResponse.json({
      enabled: gameState?.conflictsEnabled ?? false,
      enabledBy: gameState?.conflictsEnabledBy,
      enabledAt: gameState?.conflictsEnabledAt,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/admin/conflicts/general/toggle - Enable/disable the Conflicts subsystem.
// When enabled, the World navbar surfaces the Conflicts link / page.
// Auth: requireAdmin
// Errors: 400, 401
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
      conflictsEnabled: parsed.data.enabled,
      updatedAt: new Date(),
    };
    if (parsed.data.enabled) {
      set.conflictsEnabledBy = auth.admin.username;
      set.conflictsEnabledAt = now;
    }

    await db.collection<GameState>("gameState").updateOne(
      { _id: "current" },
      parsed.data.enabled
        ? { $set: set }
        : {
            $set: set,
            $unset: {
              conflictsEnabledBy: "",
              conflictsEnabledAt: "",
            },
          }
    );

    return NextResponse.json({
      success: true,
      conflictsEnabled: parsed.data.enabled,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
