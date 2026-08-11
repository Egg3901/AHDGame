// POST /api/admin/commodities/[type]/state-peg-country
// Sets state hard pegs for ALL states in a country.
// Body: { countryId: string, price: number }
// Auth: requireAdmin
// Errors: 401, 403, 400, 404

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { countryIdSchema } from "@/lib/api/schemas/country";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import type { CommodityPrice } from "@/lib/db/types";
import type { State } from "@/lib/db/types/state";

const schema = z.object({
  countryId: countryIdSchema,
  price: z.number().positive(),
});

export async function POST(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { type } = await params;
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { countryId, price } = parsed.data;
    const db = await getDb();

    const states = await db
      .collection<State>("states")
      .find({ countryId }, { projection: { _id: 1 } })
      .toArray();

    const stateIds = states.map((s) => String(s._id)).filter((id) => !NATIONAL_SCOPE_IDS.has(id));

    if (stateIds.length === 0)
      return NextResponse.json({ error: "No states found for country" }, { status: 404 });

    const setFields: Record<string, unknown> = { updatedAt: new Date() };
    for (const stateId of stateIds) {
      setFields[`stateHardPegs.${stateId}`] = price;
      setFields[`statePrices.${stateId}`] = price;
    }

    const result = await db
      .collection<CommodityPrice>("commodityPrices")
      .updateOne({ commodity: type } as Record<string, unknown>, { $set: setFields });

    if (result.matchedCount === 0)
      return NextResponse.json({ error: "Commodity not found" }, { status: 404 });

    return NextResponse.json({ success: true, statesPegged: stateIds.length });
  } catch (error) {
    return handleRouteError(error);
  }
}
