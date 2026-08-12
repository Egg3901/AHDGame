import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { unwindBank } from "@/lib/banking/adminUnwind";

const unwindSchema = z.object({
  corporationId: z.string().min(1),
  reason: z.string().min(1).max(500),
});

// POST /api/admin/banking/unwind - Force-unwind a private bank (admin escape hatch).
// Auth: requireAdmin only. Works even when privateBankingEnabled is false.
// Errors: 400, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.admin.userId, 10, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, unwindSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    if (!ObjectId.isValid(parsed.data.corporationId)) {
      return NextResponse.json(badRequest("Invalid corporationId").toJson(), { status: 400 });
    }

    const db = await getDb();
    const result = await unwindBank(
      db,
      new ObjectId(parsed.data.corporationId),
      parsed.data.reason
    );

    if (!result.ok) {
      const status = result.error === "Corporation not found" ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({
      success: true,
      alreadyRevoked: result.alreadyRevoked,
      depositorsFlipped: result.depositorsFlipped,
      npcDepositsReturned: result.npcDepositsReturned,
      refundedCapital: result.refundedCapital,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
