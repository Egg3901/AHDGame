// POST /api/admin/commodities/[type]/state-peg — sets a state hard peg.
// DELETE /api/admin/commodities/[type]/state-peg — removes a state hard peg.
// Auth: requireAdmin
// Errors: 403, 400, 404

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import type { CommodityPrice } from "@/lib/db/types";

const setSchema = z.object({
  stateId: z.string().min(1),
  price: z.number().positive(),
});

const stateIdSchema = z.string().min(1);

export async function POST(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { type } = await params;
    const parsed = await parseJsonBody(request, setSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);

    const { stateId, price } = parsed.data;
    const db = await getDb();
    const result = await db
      .collection<CommodityPrice>("commodityPrices")
      .updateOne({ commodity: type } as Record<string, unknown>, {
        $set: {
          [`stateHardPegs.${stateId}`]: price,
          [`statePrices.${stateId}`]: price,
          updatedAt: new Date(),
        },
      });

    if (result.matchedCount === 0) return errorResponse(404, "Commodity not found");

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { type } = await params;
    const { searchParams } = new URL(request.url);
    const rawStateId = searchParams.get("stateId");
    if (!stateIdSchema.safeParse(rawStateId).success)
      return errorResponse(400, "Missing or invalid stateId");
    const stateId = rawStateId!;
    const db = await getDb();
    const result = await db
      .collection<CommodityPrice>("commodityPrices")
      .updateOne({ commodity: type } as Record<string, unknown>, {
        $unset: { [`stateHardPegs.${stateId}`]: "" },
        $set: { updatedAt: new Date() },
      });

    if (result.matchedCount === 0) return errorResponse(404, "Commodity not found");

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
