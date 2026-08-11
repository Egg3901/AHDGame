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
import { handleRouteError } from "@/lib/api/errors";
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
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, mergeSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    if (!CORPORATION_TYPES.includes(parsed.data.sectorType as CorporationType)) {
      return NextResponse.json({ error: "Invalid sector type" }, { status: 400 });
    }
    if (parsed.data.intoCorpId && !ObjectId.isValid(parsed.data.intoCorpId)) {
      return NextResponse.json({ error: "Invalid target corporation ID" }, { status: 400 });
    }

    const db = await getDb();

    const authorized = await assertTreasuryAuthority(db, countryId, auth.user.character._id);
    if (!authorized) {
      return NextResponse.json(
        {
          error:
            "Only the Secretary of the Treasury (or equivalent), or the head of government if that seat is vacant, may reorganize National Corporations.",
        },
        { status: 403 }
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
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof Error && /not found for this country/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof Error && /into itself/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return handleRouteError(error);
  }
}
