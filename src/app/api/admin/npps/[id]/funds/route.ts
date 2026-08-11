// POST /api/admin/npps/[id]/funds
// Grants funds to a single NPP via $inc on the funds field.
// Auth: requireAdmin
// Errors: 401, 403, 400, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { z } from "zod";
import type { NPP } from "@/lib/db/types";
import { loadCharacterFxRate } from "@/lib/currency/characterFunds";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";

const schema = z.object({ amount: z.number().positive() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!schemas.objectId.safeParse(id).success)
      return NextResponse.json({ error: "Invalid NPP ID" }, { status: 400 });

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    // amount is in ANCHOR (₳) units (admin tool contract). npp.funds is in
    // LOCAL home currency (cf-inconsistency-fix Phase 8 for NPPs). Convert at
    // the boundary using the NPP's home country rate.
    const npp = await db
      .collection<NPP>("npps")
      .findOne({ _id: new ObjectId(id) }, { projection: { countryId: 1 } });
    if (!npp) throw notFound("NPP not found");

    const homeCurrency = (COUNTRY_CURRENCY_MAP[
      (npp.countryId ?? "US") as keyof typeof COUNTRY_CURRENCY_MAP
    ] ?? "USD") as CurrencyCode;
    const { rate } = await loadCharacterFxRate(db, homeCurrency);
    const amountLocal = parsed.data.amount * rate;

    const result = await db
      .collection<NPP>("npps")
      .updateOne({ _id: new ObjectId(id) }, { $inc: { funds: amountLocal } });

    if (result.matchedCount === 0) throw notFound("NPP not found");

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
