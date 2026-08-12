// GET/POST /api/corporations/[id]/bank/discount-window — emergency central-bank
// liquidity for a deposit-taking charter (B8).
// Auth: requireBasicAuth, CEO of the bank's corporation
// Errors: 400, 401, 403, 404, 409, 429

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import {
  drawDiscountWindow,
  quoteWindowForCorp,
  repayDiscountWindow,
} from "@/lib/banking/discountWindowCommands";
import { DISCOUNT_WINDOW_STIGMA, discountWindowStigma } from "@/lib/banking/discountWindow";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const schema = z.object({
  action: z.enum(["draw", "repay"]),
  amount: z.number().positive(),
});

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const ceoCheck = requireCeo(resolved.corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const quote = await quoteWindowForCorp(db, resolved.corporation);
    return NextResponse.json({
      available: quote !== null,
      ...(quote ?? {}),
      outstanding: resolved.corporation.bankCharter?.discountWindowDebt ?? 0,
      // Published so the trade-off is visible before the draw, not after.
      currentStigma: resolved.corporation.bankCharter
        ? discountWindowStigma(resolved.corporation.bankCharter)
        : 0,
      maxStigma: DISCOUNT_WINDOW_STIGMA,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(`discount-window:${auth.user.userId}`, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    if (!(await isPrivateBankingEnabled()))
      return NextResponse.json({ error: "Private banking is not enabled" }, { status: 403 });

    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const ceoCheck = requireCeo(resolved.corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const turn = await getCurrentTurn(db);
    const result =
      parsed.data.action === "draw"
        ? await drawDiscountWindow(db, resolved.corporation._id, parsed.data.amount, turn)
        : await repayDiscountWindow(db, resolved.corporation._id, parsed.data.amount, turn);

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({
      success: true,
      outstanding: result.outstanding,
      ratePercent: result.ratePercent,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
