import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { parseJsonBody } from "@/lib/api/validate";
import type { CorporateSector, Corporation } from "@/lib/db/types";
import { ObjectId } from "mongodb";

const healCooldownSchema = z.object({
  forceAll: z.boolean().optional(),
});

/**
 * GET /api/admin/heal/strategy-cooldown
 * Diagnose corporate sectors with active strategy cooldown timers.
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const currentTurn = (await getGameState())?.currentTurn ?? 0;

    const sectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { transitionCooldownUntilTurn: { $ne: null } },
        {
          projection: {
            corporationId: 1,
            stateId: 1,
            sectorType: 1,
            strategyId: 1,
            transitionFromStrategyId: 1,
            transitionStartTurn: 1,
            transitionCooldownUntilTurn: 1,
          },
        }
      )
      .toArray();

    // Fetch parent corporation names for display
    const corpIds = [...new Set(sectors.map((s) => s.corporationId.toString()))];
    const corps = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: corpIds.map((id) => new ObjectId(id)) } }, { projection: { name: 1 } })
      .toArray();
    const corpNameMap = new Map(corps.map((c) => [c._id.toString(), c.name]));

    const report = sectors.map((s) => {
      const cooldownUntil = s.transitionCooldownUntilTurn ?? 0;
      const isTransitioning = s.transitionFromStrategyId != null && s.transitionStartTurn != null;
      return {
        id: s._id.toString(),
        corporationName: corpNameMap.get(s.corporationId.toString()) ?? "Unknown",
        stateId: s.stateId,
        sectorType: s.sectorType,
        strategyId: s.strategyId ?? "standard",
        transitionFromStrategyId: s.transitionFromStrategyId ?? null,
        transitionStartTurn: s.transitionStartTurn ?? null,
        transitionCooldownUntilTurn: cooldownUntil,
        isTransitioning,
        cooldownActive: cooldownUntil > currentTurn,
        turnsRemaining: Math.max(0, cooldownUntil - currentTurn),
        isExpired: cooldownUntil <= currentTurn,
      };
    });

    return NextResponse.json({ currentTurn, sectors: report, total: sectors.length });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/strategy-cooldown
 * Clears strategy cooldown timers on corporate sectors.
 * By default only clears expired cooldowns.
 * Pass { forceAll: true } to clear active cooldowns too.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, healCooldownSchema);
    const body = parsed.success ? parsed.data : {};
    const forceAll = body.forceAll === true;

    const db = await getDb();
    const currentTurn = (await getGameState())?.currentTurn ?? 0;

    const sectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { transitionCooldownUntilTurn: { $ne: null } },
        {
          projection: {
            corporationId: 1,
            stateId: 1,
            sectorType: 1,
            transitionCooldownUntilTurn: 1,
          },
        }
      )
      .toArray();

    // Fetch parent corporation names
    const corpIds = [...new Set(sectors.map((s) => s.corporationId.toString()))];
    const corps = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: corpIds.map((id) => new ObjectId(id)) } }, { projection: { name: 1 } })
      .toArray();
    const corpNameMap = new Map(corps.map((c) => [c._id.toString(), c.name]));

    const cleared: Array<{ name: string; sector: string; reason: string }> = [];
    const skipped: Array<{ name: string; sector: string; turnsRemaining: number }> = [];

    for (const sector of sectors) {
      const cooldownUntil = sector.transitionCooldownUntilTurn ?? 0;
      const isExpired = cooldownUntil <= currentTurn;
      const label = corpNameMap.get(sector.corporationId.toString()) ?? "Unknown";
      const sectorLabel = `${sector.stateId} (${sector.sectorType})`;

      if (forceAll || isExpired) {
        await db.collection<CorporateSector>("corporateSectors").updateOne(
          { _id: sector._id },
          {
            $set: {
              transitionCooldownUntilTurn: null,
            },
          }
        );
        cleared.push({
          name: label,
          sector: sectorLabel,
          reason: forceAll && !isExpired ? "force-cleared (still active)" : "expired",
        });
      } else {
        skipped.push({
          name: label,
          sector: sectorLabel,
          turnsRemaining: cooldownUntil - currentTurn,
        });
      }
    }

    return NextResponse.json({
      message: `Cleared ${cleared.length} sector cooldown(s), skipped ${skipped.length} with active cooldowns`,
      cleared,
      skipped,
      currentTurn,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
