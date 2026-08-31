import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { GameState } from "@/lib/db/types";
import { nppOffensiveFlagFrom } from "@/lib/nppAutonomy/offensiveFlags";

const bodySchema = z.object({
  flag: z.enum(["initiation", "join"]),
  enabled: z.boolean(),
});

/**
 * The two switches share one route because they are one admin decision with two
 * halves, and splitting them would duplicate the guard and the attribution write for
 * nothing. `flag` says which half is being set; each keeps its own stored state.
 */
const FIELDS = {
  initiation: {
    enabled: "nppOffensiveInitiationEnabled",
    by: "nppOffensiveInitiationEnabledBy",
    at: "nppOffensiveInitiationEnabledAt",
  },
  join: {
    enabled: "nppOffensiveJoinEnabled",
    by: "nppOffensiveJoinEnabledBy",
    at: "nppOffensiveJoinEnabledAt",
  },
} as const;

// GET /api/admin/conflicts/npp-offensives/toggle - Read both NPP offensive switches.
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameState = await db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          nppOffensiveInitiationEnabled: 1,
          nppOffensiveInitiationEnabledBy: 1,
          nppOffensiveInitiationEnabledAt: 1,
          nppOffensiveJoinEnabled: 1,
          nppOffensiveJoinEnabledBy: 1,
          nppOffensiveJoinEnabledAt: 1,
        },
      }
    );
    return NextResponse.json({
      initiation: {
        enabled: nppOffensiveFlagFrom(gameState?.nppOffensiveInitiationEnabled),
        enabledBy: gameState?.nppOffensiveInitiationEnabledBy ?? null,
        enabledAt: gameState?.nppOffensiveInitiationEnabledAt ?? null,
      },
      join: {
        enabled: nppOffensiveFlagFrom(gameState?.nppOffensiveJoinEnabled),
        enabledBy: gameState?.nppOffensiveJoinEnabledBy ?? null,
        enabledAt: gameState?.nppOffensiveJoinEnabledAt ?? null,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/admin/conflicts/npp-offensives/toggle - Set one NPP offensive switch.
// `initiation` lets an NPP belligerent declare an offensive of its own; `join` lets it
// follow an ally's offensive at a front where it already has troops. Both default off.
// Auth: requireAdmin
// Errors: 400, 403
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { flag, enabled } = parsed.data;
    const fields = FIELDS[flag];
    const db = await getDb();
    const set: Record<string, unknown> = {
      [fields.enabled]: enabled,
      updatedAt: new Date(),
    };
    if (enabled) {
      set[fields.by] = auth.admin.username;
      set[fields.at] = new Date().toISOString();
    }

    await db.collection<GameState>("gameState").updateOne(
      { _id: "current" },
      enabled
        ? { $set: set }
        : {
            $set: set,
            $unset: { [fields.by]: "", [fields.at]: "" },
          }
    );

    return NextResponse.json({ success: true, flag, enabled });
  } catch (error) {
    return handleRouteError(error);
  }
}
