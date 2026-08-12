import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, forbidden, notFound, badRequest } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { ZOD_CURRENCY_ENUM } from "@/lib/constants/currencies";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { issueCharter, revokeCharter, isChairOfCurrencyBank } from "@/lib/banking/charter";
import type { BankCharterType } from "@/lib/db/types/bank";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const issueSchema = z.object({
  type: z.enum(["retail", "investment", "universal"]),
  currency: z.enum(ZOD_CURRENCY_ENUM),
});

const revokeSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required").max(500),
});

// POST /api/corporations/[id]/bank/charter — Issue a bank charter (CEO only).
// Auth: requireAuth (CEO)
// Errors: 400, 401, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    if (!(await isPrivateBankingEnabled())) {
      throw notFound("Not found");
    }

    const { id } = await params;
    const parsed = await parseJsonBody(request, issueSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const result = await issueCharter(
      db,
      corporation._id,
      parsed.data.type as BankCharterType,
      parsed.data.currency
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.reasons[0] ?? "Not eligible to charter", reasons: result.reasons },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      charter: result.charter,
      postedCapital: result.postedCapital,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE /api/corporations/[id]/bank/charter — Revoke a bank charter.
// Auth: requireAuth (central-bank chair of charter currency, or admin). CEO may not self-revoke.
// Errors: 400, 401, 403, 404
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    if (!(await isPrivateBankingEnabled())) {
      throw notFound("Not found");
    }

    const { id } = await params;
    const parsed = await parseJsonBody(request, revokeSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    if (corporation.bankCharter?.status !== "active") {
      throw badRequest("Corporation has no active bank charter");
    }

    const isAdmin = auth.user.isAdmin === true;
    const character = auth.user.character;
    if (!isAdmin) {
      if (!character) {
        throw forbidden("Character required");
      }
      // CEO may not self-revoke; only the CB chair of the charter currency may.
      if (corporation.userId && corporation.userId.toString() === auth.user.userId) {
        throw forbidden("The CEO cannot revoke their own bank charter");
      }
      const isChair = await isChairOfCurrencyBank(
        db,
        character._id,
        corporation.bankCharter.currency
      );
      if (!isChair) {
        throw forbidden(
          "Only the central-bank chair of the charter currency (or an admin) may revoke"
        );
      }
    }

    const result = await revokeCharter(db, corporation._id, parsed.data.reason);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      charter: result.charter,
      refundedCapital: result.refundedCapital,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
