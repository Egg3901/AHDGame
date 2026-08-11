// POST /api/admin/corporations/[id]/capital
// Adds liquid capital to a corporation (positive = grant, negative = drain).
// Body: { amount: number }
// Auth: requireAdmin
// Errors: 401, 403, 400, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import type { Corporation } from "@/lib/db/types";
import { anchorToCorpLiquidCapital, getCorpFxRate } from "@/lib/currency/corporationCapital";

const schema = z.object({ amount: z.number().refine((n) => n !== 0, "Amount must be non-zero") });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    // Admin amount is entered in ₳ (internal/anchor units). Convert to the
    // corp's home currency before writing so the value matches the rest of
    // liquidCapital (which is stored in home currency post forex migration).
    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(id) });
    if (!corp) throw notFound("Corporation not found");
    const fxRate = await getCorpFxRate(db, corp);
    const amountInCorpCapital = anchorToCorpLiquidCapital(parsed.data.amount, corp, fxRate);
    const result = await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: new ObjectId(id) },
        { $inc: { liquidCapital: amountInCorpCapital }, $set: { updatedAt: new Date() } }
      );
    if (result.matchedCount === 0) throw notFound("Corporation not found");

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
