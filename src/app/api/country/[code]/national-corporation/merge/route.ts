// POST /api/country/[code]/national-corporation/merge
// Finance-minister-equivalent folds a split-off's sector type back into another
// National Corporation (default: the primary) and dissolves the empty shell.
// State-internal reorg; money-neutral. Spec §24.2.
// Auth: requireAuthWithCharacter + assertTreasuryAuthority
// Errors: 400, 401, 403, 404, 429
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { CORPORATION_TYPES, type CorporationType } from "@/lib/constants/corporations";
import { assertTreasuryAuthority } from "@/lib/nationalization/authority";
import { mergeBackSectorType } from "@/lib/nationalization/restructure";

const mergeSchema = z.object({
  sectorType: z.string(),
  intoCorpId: z.string().length(24).optional(),
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

    const parsed = await parseJsonBody(request, mergeSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    if (!CORPORATION_TYPES.includes(parsed.data.sectorType as CorporationType)) {
      return errorResponse(400, "Invalid sector type");
    }
    if (parsed.data.intoCorpId && !ObjectId.isValid(parsed.data.intoCorpId)) {
      return errorResponse(400, "Invalid target corporation ID");
    }

    const db = await getDb();

    const authorized = await assertTreasuryAuthority(db, countryId, auth.user.character._id);
    if (!authorized) {
      return errorResponse(
        403,
        "Only the Secretary of the Treasury (or equivalent), or the head of government if that seat is vacant, may reorganize National Corporations."
      );
    }

    const result = await mergeBackSectorType(db, {
      countryId,
      sectorType: parsed.data.sectorType as CorporationType,
      intoCorpId: parsed.data.intoCorpId ? new ObjectId(parsed.data.intoCorpId) : undefined,
    });

    return NextResponse.json({
      success: true,
      targetNationalCorporationId: result.targetNationalCorporationId.toString(),
      dissolvedNationalCorporationId: result.dissolvedNationalCorporationId.toString(),
      sectorsMoved: result.sectorsMoved,
    });
  } catch (error) {
    if (error instanceof Error && /no split-off/i.test(error.message)) {
      return errorResponse(404, error.message);
    }
    if (error instanceof Error && /not found for this country/i.test(error.message)) {
      return errorResponse(404, error.message);
    }
    if (error instanceof Error && /into itself/i.test(error.message)) {
      return errorResponse(400, error.message);
    }
    return handleRouteError(error);
  }
}
