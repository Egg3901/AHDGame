// POST /api/country/[code]/national-corporation/split
// Finance-minister-equivalent carves a sector type into a new secondary National
// Corporation (state-internal reorg; money-neutral). Spec §24.2.
// Auth: requireAuthWithCharacter + assertTreasuryAuthority
// Errors: 400, 401, 403, 409, 429
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isOperatingSectorType, type OperatingSectorType } from "@/lib/constants/corporations";
import { assertTreasuryAuthority } from "@/lib/nationalization/authority";
import { splitOffSectorType } from "@/lib/nationalization/restructure";

const splitSchema = z.object({
  sectorType: z.string(),
  newCorpName: z.string().min(2).max(80),
});

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country code");
    }

    const parsed = await parseJsonBody(request, splitSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    if (!isOperatingSectorType(parsed.data.sectorType)) {
      return errorResponse(400, "Invalid sector type");
    }

    const db = await getDb();

    const authorized = await assertTreasuryAuthority(db, countryId, auth.user.character._id);
    if (!authorized) {
      return errorResponse(
        403,
        "Only the Secretary of the Treasury (or equivalent), or the head of government if that seat is vacant, may reorganize National Corporations."
      );
    }

    const result = await splitOffSectorType(db, {
      countryId,
      sectorType: parsed.data.sectorType as OperatingSectorType,
      newCorpName: parsed.data.newCorpName,
    });

    return NextResponse.json({
      success: true,
      newNationalCorporationId: result.newNationalCorporationId.toString(),
      sectorsMoved: result.sectorsMoved,
    });
  } catch (error) {
    if (error instanceof Error && /already owns/i.test(error.message)) {
      return errorResponse(409, error.message);
    }
    if (error instanceof Error && /too short/i.test(error.message)) {
      return errorResponse(400, error.message);
    }
    return handleRouteError(error);
  }
}
