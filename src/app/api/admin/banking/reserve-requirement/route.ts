import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound, forbidden } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { ZOD_CURRENCY_ENUM } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { isChairOfCurrencyBank } from "@/lib/banking/charter";
import { setReserveRequirement } from "@/lib/banking/reserves";

const reserveSchema = z.object({
  currency: z.enum(ZOD_CURRENCY_ENUM),
  ratio: z.number().finite(),
});

// PUT /api/admin/banking/reserve-requirement - Set CB reserve ratio for a currency.
// Auth: requireAuth (admin or CB chair of that currency)
// Errors: 400, 401, 403, 404
export async function PUT(request: Request) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    if (!(await isPrivateBankingEnabled())) {
      throw notFound("Not found");
    }

    const parsed = await parseJsonBody(request, reserveSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const currency = parsed.data.currency as CurrencyCode;
    const db = await getDb();

    const isAdmin = auth.user.isAdmin === true;
    if (!isAdmin) {
      const character = auth.user.character;
      if (!character) {
        throw forbidden("Character required");
      }
      const isChair = await isChairOfCurrencyBank(db, character._id, currency);
      if (!isChair) {
        throw forbidden(
          "Only the central-bank chair of that currency (or an admin) may set the reserve requirement"
        );
      }
    }

    const result = await setReserveRequirement(db, currency, parsed.data.ratio);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      currency,
      ratio: result.ratio,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
