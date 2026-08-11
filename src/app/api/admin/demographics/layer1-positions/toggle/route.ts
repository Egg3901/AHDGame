import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { GameState } from "@/lib/db/types";

const bodySchema = z.object({ enabled: z.boolean() });

// GET /api/admin/demographics/layer1-positions/toggle — read the current flag.
// Auth: requireAdmin
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameState = await db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          demographicsLayer1PositionsEnabled: 1,
          demographicsLayer1PositionsEnabledBy: 1,
          demographicsLayer1PositionsEnabledAt: 1,
        },
      }
    );
    return NextResponse.json({
      enabled: gameState?.demographicsLayer1PositionsEnabled ?? false,
      enabledBy: gameState?.demographicsLayer1PositionsEnabledBy,
      enabledAt: gameState?.demographicsLayer1PositionsEnabledAt,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/admin/demographics/layer1-positions/toggle — enable/disable Layer-1 position derivation.
// Auth: requireAdmin
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
      demographicsLayer1PositionsEnabled: parsed.data.enabled,
      updatedAt: new Date(),
    };
    if (parsed.data.enabled) {
      set.demographicsLayer1PositionsEnabledBy = auth.admin.username;
      set.demographicsLayer1PositionsEnabledAt = now;
    }

    await db.collection<GameState>("gameState").updateOne(
      { _id: "current" },
      parsed.data.enabled
        ? { $set: set }
        : {
            $set: set,
            $unset: {
              demographicsLayer1PositionsEnabledBy: "",
              demographicsLayer1PositionsEnabledAt: "",
            },
          }
    );

    return NextResponse.json({
      success: true,
      demographicsLayer1PositionsEnabled: parsed.data.enabled,
      note: parsed.data.enabled ? "Reseed demographics for the change to take effect." : undefined,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
