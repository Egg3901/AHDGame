// POST /api/admin/commodities/[type]/peg — sets a persistent global hard peg.
// DELETE /api/admin/commodities/[type]/peg — removes the global hard peg.
// Auth: requireAdmin
// Errors: 403, 400, 404

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import type { CommodityPrice } from "@/lib/db/types";

const schema = z.object({ price: z.number().positive() });

export async function POST(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { type } = await params;
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const result = await db
      .collection<CommodityPrice>("commodityPrices")
      .updateOne({ commodity: type } as Record<string, unknown>, {
        $set: {
          hardPeg: parsed.data.price,
          globalPrice: parsed.data.price,
          updatedAt: new Date(),
        },
      });

    if (result.matchedCount === 0)
      return NextResponse.json({ error: "Commodity not found" }, { status: 404 });

    return NextResponse.json({ success: true, hardPeg: parsed.data.price });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { type } = await params;
    const db = await getDb();
    const result = await db
      .collection<CommodityPrice>("commodityPrices")
      .updateOne({ commodity: type } as Record<string, unknown>, {
        $unset: { hardPeg: "" },
        $set: { updatedAt: new Date() },
      });

    if (result.matchedCount === 0)
      return NextResponse.json({ error: "Commodity not found" }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
