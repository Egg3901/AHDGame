import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isBankPropTradingEnabled } from "@/lib/banking/featureFlag";
import { drawCbMargin, repayCbMargin } from "@/lib/banking/interbank";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const marginSchema = z.object({
  action: z.enum(["draw", "repay"]),
  amount: z.number().finite().positive(),
});

// POST /api/corporations/[id]/bank/interbank/margin — Draw or repay CB margin (CEO).
// Auth: requireAuth (CEO)
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
    const parsed = await parseJsonBody(request, marginSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const result =
      parsed.data.action === "draw"
        ? await drawCbMargin(db, corporation._id, parsed.data.amount)
        : await repayCbMargin(db, corporation._id, parsed.data.amount);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      action: parsed.data.action,
      amount: result.amount,
      cbMarginDebt: result.cbMarginDebt,
      cashReserves: result.cashReserves,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
