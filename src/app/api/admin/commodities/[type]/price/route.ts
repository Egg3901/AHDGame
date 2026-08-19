// PATCH /api/admin/commodities/[type]/price
// Sets a one-turn nudge price override on the most recent commodity document.
// Body: { price: number }
// Auth: requireAdmin
// Errors: 403, 400, 404

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import type { CommodityPrice, GameState } from "@/lib/db/types";

const schema = z.object({ price: z.number().positive() });

export async function PATCH(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { type } = await params;
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const gameState = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
    const currentTurn = gameState?.currentTurn ?? 0;

    // Update the most recent document for this commodity.
    // Cast filter to Record<string, unknown> because CommodityType is a union
    // and `type` is a plain string from the URL parameter.
    const result = await db
      .collection<CommodityPrice>("commodityPrices")
      .updateOne({ commodity: type } as Record<string, unknown>, {
        $set: {
          nudgePrice: parsed.data.price,
          nudgeTurn: currentTurn,
          updatedAt: new Date(),
        },
      });

    if (result.matchedCount === 0)
      return NextResponse.json({ error: "Commodity not found" }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
