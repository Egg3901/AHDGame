import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse, SAVINGS_WALLET_LIMITS } from "@/lib/api/rateLimit";
import { ZOD_CURRENCY_ENUM } from "@/lib/constants/currencies";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { moveCharacterSavings } from "@/lib/banking/deposits";
import type { SavingsHolder } from "@/lib/db/types/bank";

const holderSchema = z.object({
  currency: z.enum(ZOD_CURRENCY_ENUM),
  holder: z.union([z.literal("centralBank"), z.string().length(24)]),
});

// PUT /api/character/savings-holder — Move the authed character's savings pointer.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 404
export async function PUT(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(
      auth.user.userId,
      SAVINGS_WALLET_LIMITS.maxRequests,
      SAVINGS_WALLET_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    if (!(await isPrivateBankingEnabled())) {
      throw notFound("Not found");
    }

    const parsed = await parseJsonBody(request, holderSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const result = await moveCharacterSavings(
      db,
      auth.user.character._id,
      parsed.data.currency,
      parsed.data.holder as SavingsHolder
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      currency: parsed.data.currency,
      holder: result.holder,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
