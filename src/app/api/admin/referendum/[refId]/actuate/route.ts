import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { actuateReferendumTransfer } from "@/lib/referendum/transfer/actuateReferendum";

// POST /api/admin/referendum/[refId]/actuate
// Admin-only conversion-window action on a passed referendum:
//   action "resolve" → run the transfer now (NI → Ireland) + mark completed.
//   action "block"   → cancel the conversion; the region does not transfer.
// Errors: 400, 401, 404
export async function POST(request: Request, { params }: { params: Promise<{ refId: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { refId } = await params;
    const db = await getDb();

    const parsed = await parseJsonBody(
      request,
      z.object({ action: z.union([z.literal("resolve"), z.literal("block")]).default("resolve") })
    );
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const currentTurn = await getCurrentTurn(db);
    const result = await actuateReferendumTransfer(db, {
      referendumId: refId,
      currentTurn,
      action: parsed.data.action,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
