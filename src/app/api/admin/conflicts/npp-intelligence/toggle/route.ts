import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { GameState } from "@/lib/db/types";
import { militarySabotageFlagFrom, nppIntelligenceFlagFrom } from "@/lib/intelligence/flags";

const bodySchema = z.object({
  flag: z.enum(["operations", "sabotage"]).default("operations"),
  enabled: z.boolean(),
});

/**
 * Two switches, one route, because they are one admin decision with two halves:
 * what the intelligence system is allowed to do without a human deciding.
 * `operations` lets NPP countries act at all; `sabotage` lets a successful
 * military covert action have real effects, and is held back because its
 * magnitudes are a balance change whose report could not be produced.
 */
const FIELDS = {
  operations: {
    enabled: "nppIntelligenceOperationsEnabled",
    by: "nppIntelligenceOperationsEnabledBy",
    at: "nppIntelligenceOperationsEnabledAt",
  },
  sabotage: {
    enabled: "intelligenceMilitarySabotageEnabled",
    by: "intelligenceMilitarySabotageEnabledBy",
    at: "intelligenceMilitarySabotageEnabledAt",
  },
} as const;

// GET /api/admin/conflicts/npp-intelligence/toggle - Read the NPP intelligence switch.
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
          nppIntelligenceOperationsEnabled: 1,
          nppIntelligenceOperationsEnabledBy: 1,
          nppIntelligenceOperationsEnabledAt: 1,
          intelligenceMilitarySabotageEnabled: 1,
          intelligenceMilitarySabotageEnabledBy: 1,
          intelligenceMilitarySabotageEnabledAt: 1,
        },
      }
    );
    return NextResponse.json({
      operations: {
        enabled: nppIntelligenceFlagFrom(gameState?.nppIntelligenceOperationsEnabled),
        enabledBy: gameState?.nppIntelligenceOperationsEnabledBy ?? null,
        enabledAt: gameState?.nppIntelligenceOperationsEnabledAt ?? null,
      },
      sabotage: {
        enabled: militarySabotageFlagFrom(gameState?.intelligenceMilitarySabotageEnabled),
        enabledBy: gameState?.intelligenceMilitarySabotageEnabledBy ?? null,
        enabledAt: gameState?.intelligenceMilitarySabotageEnabledAt ?? null,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/admin/conflicts/npp-intelligence/toggle - Set the NPP intelligence switch.
// Lets NPP countries build networks and run operations of their own. Defaults off.
// Counter-intelligence posture is derived every turn either way, because defence
// needs no order.
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
