import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { TYPE_SWITCH_PENALTY_TURNS } from "@/lib/constants/corporations";
import { parseJsonBody } from "@/lib/api/validate";
import type { Corporation } from "@/lib/db/types";

const healTimersSchema = z.object({
  forceAll: z.boolean().optional(),
});

/**
 * GET /api/admin/heal/corporation-timers
 * Diagnose corporations with stale or incorrect type-switch timers.
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const currentTurn = (await getGameState())?.currentTurn ?? 0;

    const corps = await db
      .collection<Corporation>("corporations")
      .find(
        {
          $or: [{ typeSwitchTurn: { $ne: null } }, { typeSwitchCooldownUntilTurn: { $ne: null } }],
        },
        { projection: { name: 1, typeSwitchTurn: 1, typeSwitchCooldownUntilTurn: 1 } }
      )
      .toArray();

    const report = corps.map((c) => {
      const cooldownUntil = c.typeSwitchCooldownUntilTurn ?? 0;
      const penaltyExpiredAt = (c.typeSwitchTurn ?? 0) + TYPE_SWITCH_PENALTY_TURNS;
      return {
        id: c._id.toString(),
        name: c.name,
        typeSwitchTurn: c.typeSwitchTurn ?? null,
        typeSwitchCooldownUntilTurn: cooldownUntil,
        penaltyActive:
          c.typeSwitchTurn != null && currentTurn - c.typeSwitchTurn < TYPE_SWITCH_PENALTY_TURNS,
        penaltyExpiredAt,
        cooldownActive: cooldownUntil > currentTurn,
        turnsRemainingOnCooldown: Math.max(0, cooldownUntil - currentTurn),
        isExpired: cooldownUntil <= currentTurn,
      };
    });

    return NextResponse.json({ currentTurn, corporations: report, total: corps.length });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/corporation-timers
 * Clears expired type-switch timer fields from all corporations.
 * Only removes timers where the cooldown has already passed.
 * To force-clear all timers regardless of expiry, pass { forceAll: true }.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, healTimersSchema);
    const body = parsed.success ? parsed.data : {};
    const forceAll = body.forceAll === true;

    const db = await getDb();
    const currentTurn = (await getGameState())?.currentTurn ?? 0;

    const corps = await db
      .collection<Corporation>("corporations")
      .find(
        {
          $or: [{ typeSwitchTurn: { $ne: null } }, { typeSwitchCooldownUntilTurn: { $ne: null } }],
        },
        { projection: { name: 1, typeSwitchTurn: 1, typeSwitchCooldownUntilTurn: 1 } }
      )
      .toArray();

    const cleared: Array<{ name: string; reason: string }> = [];
    const skipped: Array<{ name: string; turnsRemaining: number }> = [];

    for (const corp of corps) {
      const cooldownUntil = corp.typeSwitchCooldownUntilTurn ?? 0;
      const isExpired = cooldownUntil <= currentTurn;

      if (forceAll || isExpired) {
        await db.collection<Corporation>("corporations").updateOne(
          { _id: corp._id },
          {
            $unset: { typeSwitchTurn: "", typeSwitchCooldownUntilTurn: "" },
          }
        );
        cleared.push({
          name: corp.name,
          reason: forceAll && !isExpired ? "force-cleared (still active)" : "expired",
        });
      } else {
        skipped.push({
          name: corp.name,
          turnsRemaining: cooldownUntil - currentTurn,
        });
      }
    }

    return NextResponse.json({
      message: `Cleared ${cleared.length} corporation(s), skipped ${skipped.length} with active cooldowns`,
      cleared,
      skipped,
      currentTurn,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
