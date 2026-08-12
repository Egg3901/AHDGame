import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, notFound } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isBankPropTradingEnabled } from "@/lib/banking/featureFlag";
import { lendInterbank } from "@/lib/banking/interbank";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const lendSchema = z.object({
  borrowerCorporationId: z.string().min(1),
  amount: z.number().finite().positive(),
  ratePercent: z.number().finite().nonnegative(),
});

// POST /api/corporations/[id]/bank/interbank/loans — Originate interbank loan (CEO of lender).
// Auth: requireAuth (CEO of lender corp)
// Errors: 400, 401, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    if (!(await isBankPropTradingEnabled())) {
      throw notFound("Not found");
    }

    const { id } = await params;
    const parsed = await parseJsonBody(request, lendSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    if (!ObjectId.isValid(parsed.data.borrowerCorporationId)) {
      throw badRequest("Invalid borrowerCorporationId");
    }

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const result = await lendInterbank(
      db,
      corporation._id,
      new ObjectId(parsed.data.borrowerCorporationId),
      parsed.data.amount,
      parsed.data.ratePercent
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      loan: result.loan,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
