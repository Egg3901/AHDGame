// POST /api/admin/forex/[currencyId]/peg — sets hardPeg and applies rate immediately.
// DELETE /api/admin/forex/[currencyId]/peg — removes hardPeg (drift resumes next turn).
// Auth: requireAdmin
// Errors: 400, 403, 404

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
      .updateOne(
        { _id: currencyId },
        { $set: { rate: parsed.data.rate, hardPeg: parsed.data.rate, updatedAt: new Date() } }
      );
    if (result.matchedCount === 0) throw notFound("Currency not found");

    return NextResponse.json({ success: true, hardPeg: parsed.data.rate });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ currencyId: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { currencyId } = await params;
    const db = await getDb();
    const result = await db
      .collection<ExchangeRate>("exchangeRates")
      .updateOne({ _id: currencyId }, { $set: { hardPeg: null, updatedAt: new Date() } });
    if (result.matchedCount === 0) throw notFound("Currency not found");

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
