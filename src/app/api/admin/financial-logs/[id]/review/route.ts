// POST /api/admin/financial-logs/[id]/review — dismiss or un-dismiss a suspect flag on a transaction
// Auth: requireAdmin
// Errors: 400, 403, 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";

const reviewSchema = z.object({
  flagIndex: z.number().int().min(0),
  dismissed: z.boolean(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!/^[0-9a-f]{24}$/i.test(id)) {
      return NextResponse.json({ error: "Invalid log entry id" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, reviewSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { flagIndex, dismissed } = parsed.data;
    const db = await getDb();

    const entry = await db
      .collection<FinancialTxLogEntry>("financialTxLog")
      .findOne({ _id: new ObjectId(id) });

    if (!entry) {
      return NextResponse.json({ error: "Log entry not found" }, { status: 404 });
    }

    const flags = Array.isArray(entry.suspectFlags) ? entry.suspectFlags : [];
    if (flagIndex >= flags.length) {
      return NextResponse.json({ error: "Flag index out of range" }, { status: 400 });
    }

    const adminId = new ObjectId(auth.admin.userId);
    const now = new Date();

    // Compute new flagged state after this update
    const newFlagged = flags.some((f, i) => (i === flagIndex ? !dismissed : !f.dismissed));

    await db.collection<FinancialTxLogEntry>("financialTxLog").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          [`suspectFlags.${flagIndex}.dismissed`]: dismissed,
          [`suspectFlags.${flagIndex}.reviewedByAdminId`]: adminId,
          [`suspectFlags.${flagIndex}.reviewedAt`]: now,
          flagged: newFlagged,
        },
      }
    );

    return NextResponse.json({ success: true, flagged: newFlagged });
  } catch (error) {
    return handleRouteError(error);
  }
}
