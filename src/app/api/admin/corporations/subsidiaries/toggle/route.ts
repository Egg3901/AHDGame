import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { GameState } from "@/lib/db/types";

const bodySchema = z.object({ enabled: z.boolean() });

/**
 * GET /api/admin/corporations/subsidiaries/toggle
 * Report the current subsidiary-corporations flag (for the admin panel).
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const db = await getDb();
    const gs = await db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          subsidiaryCorporationsEnabled: 1,
          subsidiaryCorporationsEnabledBy: 1,
          subsidiaryCorporationsEnabledAt: 1,
        },
      }
    );
    return NextResponse.json({
      subsidiaryCorporationsEnabled: gs?.subsidiaryCorporationsEnabled === true,
      subsidiaryCorporationsEnabledBy: gs?.subsidiaryCorporationsEnabledBy ?? null,
      subsidiaryCorporationsEnabledAt: gs?.subsidiaryCorporationsEnabledAt ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/corporations/subsidiaries/toggle
 * Flip the subsidiary-corporations system on/off (acquisition management +
 * spin-off). When off, mutate routes 403 and the turn processor skips cleanup.
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
      subsidiaryCorporationsEnabled: parsed.data.enabled,
      updatedAt: new Date(),
    };
    if (parsed.data.enabled) {
      set.subsidiaryCorporationsEnabledBy = auth.admin.username;
      set.subsidiaryCorporationsEnabledAt = now;
    }

    await db.collection<GameState>("gameState").updateOne(
      { _id: "current" },
      parsed.data.enabled
        ? { $set: set }
        : {
            $set: set,
            $unset: {
              subsidiaryCorporationsEnabledBy: "",
              subsidiaryCorporationsEnabledAt: "",
            },
          }
    );

    return NextResponse.json({
      success: true,
      subsidiaryCorporationsEnabled: parsed.data.enabled,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
