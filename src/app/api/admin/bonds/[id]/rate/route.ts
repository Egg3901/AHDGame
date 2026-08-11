// PATCH /api/admin/bonds/[id]/rate
// Permanently overrides the coupon rate on a bond.
// Body: { couponRate: number (0–100) }
// Auth: requireAdmin
// Errors: 401, 403, 400, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import type { Bond } from "@/lib/db/types";

const schema = z.object({ couponRate: z.number().min(0).max(100) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const result = await db
      .collection<Bond>("bonds")
      .updateOne({ _id: new ObjectId(id) }, { $set: { couponRate: parsed.data.couponRate } });
    if (result.matchedCount === 0) throw notFound("Bond not found");

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
