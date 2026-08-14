import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound, badRequest } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { acceptLoan, rejectLoan } from "@/lib/banking/loanApproval";

interface RouteParams {
  params: Promise<{ id: string; loanId: string }>;
}

const decisionSchema = z.object({
  decision: z.enum(["accept", "reject"]),
  reason: z.string().max(280).optional(),
});

// POST /api/corporations/[id]/bank/loans/[loanId]/decision — Accept or reject a
// pending loan (CEO only).
// Auth: requireAuth (CEO)
// Errors: 400, 401, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    if (!(await isPrivateBankingEnabled())) {
      throw notFound("Not found");
    }

    const { id, loanId } = await params;
    if (!ObjectId.isValid(loanId)) {
      throw badRequest("Invalid loan id");
    }
    const parsed = await parseJsonBody(request, decisionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const loanObjectId = new ObjectId(loanId);
    const result =
      parsed.data.decision === "accept"
        ? await acceptLoan(db, corporation._id, loanObjectId)
        : await rejectLoan(db, corporation._id, loanObjectId, parsed.data.reason);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, status: result.loan.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
