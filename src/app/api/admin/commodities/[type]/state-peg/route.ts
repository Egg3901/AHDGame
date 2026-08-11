// POST /api/admin/commodities/[type]/state-peg — sets a state hard peg.
// DELETE /api/admin/commodities/[type]/state-peg — removes a state hard peg.
// Auth: requireAdmin
// Errors: 401, 403, 400, 404

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
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
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

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

    if (result.matchedCount === 0)
      return NextResponse.json({ error: "Commodity not found" }, { status: 404 });

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
      return NextResponse.json({ error: "Missing or invalid stateId" }, { status: 400 });
    const stateId = rawStateId!;
    const db = await getDb();
    const result = await db
      .collection<CommodityPrice>("commodityPrices")
      .updateOne({ commodity: type } as Record<string, unknown>, {
        $unset: { [`stateHardPegs.${stateId}`]: "" },
        $set: { updatedAt: new Date() },
      });

    if (result.matchedCount === 0)
      return NextResponse.json({ error: "Commodity not found" }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
