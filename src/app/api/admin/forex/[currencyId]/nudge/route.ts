// POST /api/admin/forex/[currencyId]/nudge
// Sets the exchange rate once; normal drift resumes next turn.
// Body: { rate: number }
// Auth: requireAdmin
// Errors: 401, 403, 404

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import type { ExchangeRate } from "@/lib/db/types";

const schema = z.object({ rate: z.number().positive() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ currencyId: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { currencyId } = await params;
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const result = await db
      .collection<ExchangeRate>("exchangeRates")
      .updateOne({ _id: currencyId }, { $set: { rate: parsed.data.rate, updatedAt: new Date() } });
    if (result.matchedCount === 0) throw notFound("Currency not found");

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
