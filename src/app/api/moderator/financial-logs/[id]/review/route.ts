import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createModAuditLog } from "@/lib/modAuditLog";
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
    const auth = await requireModerator();
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

    const moderatorId = new ObjectId(auth.user.userId);
    const now = new Date();
    const selectedFlag = flags[flagIndex];
    const newFlagged = flags.some((flag, index) =>
      index === flagIndex ? !dismissed : !flag.dismissed
    );

    await db.collection<FinancialTxLogEntry>("financialTxLog").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          [`suspectFlags.${flagIndex}.dismissed`]: dismissed,
          [`suspectFlags.${flagIndex}.reviewedByAdminId`]: moderatorId,
          [`suspectFlags.${flagIndex}.reviewedAt`]: now,
          flagged: newFlagged,
        },
      }
    );

    await createModAuditLog({
      moderatorId: auth.user.userId,
      moderatorName: auth.user.username,
      action: "review_financial_tx_flag",
      targetUserId: entry.subjectType === "character" ? entry.subjectId?.toHexString() : undefined,
      targetUsername: entry.subjectName,
      details: `${dismissed ? "Dismissed" : "Reopened"} ${selectedFlag?.type ?? "suspect"} flag on ${entry.subjectType} ${entry.subjectName}`,
    });

    return NextResponse.json({ success: true, flagged: newFlagged });
  } catch (error) {
    return handleRouteError(error);
  }
}
